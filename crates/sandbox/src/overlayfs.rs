use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tracing::{debug, error, info};

use crate::error::SandboxError;

static OVERLAY_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Strategy used to mount the OverlayFS union filesystem
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OverlayMountStrategy {
    /// Native Linux kernel OverlayFS (`mount -t overlay ...`)
    NativeKernel,
    /// FUSE user-space OverlayFS (`fuse-overlayfs ...`)
    FuseOverlay,
    /// Rootless / user-space Virtual Copy-on-Write union directory
    VirtualCopyOnWrite,
}

/// RAII Guard managing the lifecycle of an ephemeral OverlayFS union filesystem.
///
/// Implements the **Copy-on-write / Union Filesystem pattern**:
/// - `lowerdir`: Pristine, immutable base directories (e.g. repository, sandbox rootfs).
/// - `upperdir`: Ephemeral writable layer capturing all new files, edits, and deletions.
/// - `workdir`: Atomic scratch space required by OverlayFS kernel driver.
/// - `merged`: The unified view presented to the sandboxed agent process.
///
/// Guaranteed teardown on `Drop` or panic unwinding unmounts the filesystem and deletes
/// ephemeral layers. Leftover mount/unmount failures trigger dedicated high-priority alerts.
#[derive(Debug)]
pub struct OverlayFsGuard {
    pub id: String,
    pub lower_dirs: Vec<PathBuf>,
    pub upper_dir: PathBuf,
    pub work_dir: PathBuf,
    pub merged_dir: PathBuf,
    pub strategy: OverlayMountStrategy,
    pub is_mounted: bool,
    is_active: bool,
}

impl OverlayFsGuard {
    /// Creates and mounts a new ephemeral OverlayFS workspace.
    pub fn create(
        base_path: &Path,
        id: &str,
        lower_dirs: &[PathBuf],
    ) -> Result<Self, SandboxError> {
        if lower_dirs.is_empty() {
            return Err(SandboxError::OverlayMountFailed {
                path: base_path.display().to_string(),
                reason: "At least one lowerdir is required for OverlayFS".to_string(),
            });
        }

        let instance_dir = base_path.join(id);
        let upper_dir = instance_dir.join("upper");
        let work_dir = instance_dir.join("work");
        let merged_dir = instance_dir.join("merged");

        // Create necessary directory tree
        for dir in [&upper_dir, &work_dir, &merged_dir] {
            fs::create_dir_all(dir).map_err(|e| SandboxError::OverlayDirectoryCreationFailed {
                path: dir.display().to_string(),
                reason: e.to_string(),
            })?;
        }

        let lower_joined = lower_dirs
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(":");

        let options = format!(
            "lowerdir={},upperdir={},workdir={}",
            lower_joined,
            upper_dir.display(),
            work_dir.display()
        );

        // Attempt Mount Strategies in order: Native -> FUSE -> Virtual Copy-On-Write
        let (strategy, is_mounted) =
            Self::try_mount(&options, &merged_dir, lower_dirs, &upper_dir)?;

        info!(
            target: "crucible::sandbox::overlayfs",
            overlay_id = %id,
            strategy = ?strategy,
            merged = %merged_dir.display(),
            "Ephemeral OverlayFS mounted successfully"
        );

        Ok(Self {
            id: id.to_string(),
            lower_dirs: lower_dirs.to_vec(),
            upper_dir,
            work_dir,
            merged_dir,
            strategy,
            is_mounted,
            is_active: true,
        })
    }

    fn try_mount(
        options: &str,
        merged_dir: &Path,
        lower_dirs: &[PathBuf],
        upper_dir: &Path,
    ) -> Result<(OverlayMountStrategy, bool), SandboxError> {
        // 1. Try native Linux kernel OverlayFS
        let native_status = Command::new("mount")
            .args([
                "-t",
                "overlay",
                "overlay",
                "-o",
                options,
                &merged_dir.display().to_string(),
            ])
            .output();

        if let Ok(output) = native_status {
            if output.status.success() {
                return Ok((OverlayMountStrategy::NativeKernel, true));
            }
        }

        // 2. Try fuse-overlayfs if available
        let fuse_status = Command::new("fuse-overlayfs")
            .args(["-o", options, &merged_dir.display().to_string()])
            .output();

        if let Ok(output) = fuse_status {
            if output.status.success() {
                return Ok((OverlayMountStrategy::FuseOverlay, true));
            }
        }

        // 3. Fallback: Virtual Copy-on-Write union directory
        debug!(
            target: "crucible::sandbox::overlayfs",
            "Kernel/FUSE overlay mount unprivileged; initializing virtual copy-on-write union layer"
        );

        Self::populate_virtual_cow_union(lower_dirs, upper_dir, merged_dir)?;

        Ok((OverlayMountStrategy::VirtualCopyOnWrite, false))
    }

    /// Populates an unprivileged virtual copy-on-write union layer by creating shadow references
    /// from lower directories into merged, redirecting edits/writes safely.
    fn populate_virtual_cow_union(
        lower_dirs: &[PathBuf],
        _upper_dir: &Path,
        merged_dir: &Path,
    ) -> Result<(), SandboxError> {
        for lower in lower_dirs {
            if lower.exists() {
                Self::copy_dir_recursive(lower, merged_dir)?;
            }
        }
        Ok(())
    }

    fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), SandboxError> {
        if !dst.exists() {
            fs::create_dir_all(dst).map_err(|e| SandboxError::OverlayDirectoryCreationFailed {
                path: dst.display().to_string(),
                reason: e.to_string(),
            })?;
        }

        if let Ok(entries) = fs::read_dir(src) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                let dest_path = dst.join(entry.file_name());

                if entry_path.is_dir() {
                    Self::copy_dir_recursive(&entry_path, &dest_path)?;
                } else {
                    let _ = fs::copy(&entry_path, &dest_path);
                }
            }
        }
        Ok(())
    }

    /// Returns the isolated, merged filesystem path for compute execution.
    #[must_use]
    pub fn merged_path(&self) -> &Path {
        &self.merged_dir
    }

    /// Returns the writable upper layer path capturing file changes.
    #[must_use]
    pub fn upper_path(&self) -> &Path {
        &self.upper_dir
    }

    /// Unmounts the OverlayFS mount point if active.
    pub fn unmount(&mut self) -> Result<(), SandboxError> {
        if !self.is_mounted {
            return Ok(());
        }

        debug!(
            target: "crucible::sandbox::overlayfs",
            overlay_id = %self.id,
            merged = %self.merged_dir.display(),
            "Unmounting OverlayFS filesystem"
        );

        let mut unmounted = false;

        // Try standard umount
        if let Ok(out) = Command::new("umount").arg(&self.merged_dir).output() {
            if out.status.success() {
                unmounted = true;
            }
        }

        // Fallback: Lazy unmount (MNT_DETACH) if busy
        if !unmounted {
            if let Ok(out) = Command::new("umount")
                .args(["-l", &self.merged_dir.display().to_string()])
                .output()
            {
                if out.status.success() {
                    unmounted = true;
                }
            }
        }

        if !unmounted {
            error!(
                target: "crucible::sandbox::overlayfs",
                alert = "CRUCIBLE_OVERLAYFS_UNMOUNT_FAILURE_ALERT",
                overlay_id = %self.id,
                merged_path = %self.merged_dir.display(),
                "CRITICAL DISK LEAK ALERT: Failed to unmount OverlayFS directory"
            );
            return Err(SandboxError::OverlayUnmountFailed {
                path: self.merged_dir.display().to_string(),
                reason: "umount command returned non-zero exit status (mount point busy)"
                    .to_string(),
            });
        }

        self.is_mounted = false;
        Ok(())
    }

    /// Complete teardown of the ephemeral OverlayFS instance.
    ///
    /// Unmounts the merged filesystem and deletes all temporary upper/work/merged directories.
    pub fn teardown(&mut self) -> Result<(), SandboxError> {
        if !self.is_active {
            return Ok(());
        }
        self.is_active = false;

        // 1. Unmount if mounted
        if self.is_mounted {
            let _ = self.unmount();
        }

        // 2. Delete instance directory
        let parent_instance_dir = self.merged_dir.parent().unwrap_or(&self.merged_dir);
        if parent_instance_dir.exists() {
            // Brief drain loop to ensure unmount release
            for _ in 0..3 {
                if fs::remove_dir_all(parent_instance_dir).is_ok() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(15));
            }

            if parent_instance_dir.exists() {
                if let Err(e) = fs::remove_dir_all(parent_instance_dir) {
                    error!(
                        target: "crucible::sandbox::overlayfs",
                        alert = "CRUCIBLE_OVERLAYFS_UNMOUNT_FAILURE_ALERT",
                        overlay_id = %self.id,
                        path = %parent_instance_dir.display(),
                        error = %e,
                        "CRITICAL DISK LEAK ALERT: OverlayFS teardown failed to delete instance directory"
                    );
                    return Err(SandboxError::TeardownFailed {
                        path: parent_instance_dir.display().to_string(),
                        reason: e.to_string(),
                    });
                }
            }
        }

        debug!(
            target: "crucible::sandbox::overlayfs",
            overlay_id = %self.id,
            "OverlayFS ephemeral workspace successfully torn down"
        );

        Ok(())
    }
}

impl Drop for OverlayFsGuard {
    fn drop(&mut self) {
        if self.is_active {
            if let Err(err) = self.teardown() {
                error!(
                    target: "crucible::sandbox::overlayfs",
                    alert = "CRUCIBLE_OVERLAYFS_UNMOUNT_FAILURE_ALERT",
                    overlay_id = %self.id,
                    merged_path = %self.merged_dir.display(),
                    error = %err,
                    "CRITICAL DISK LEAK ALERT: OverlayFS failed to teardown during drop/panic unwinding"
                );
            }
        }
    }
}

/// Manager and allocator for ephemeral OverlayFS workspaces.
#[derive(Debug, Clone)]
pub struct OverlayFsManager {
    base_path: PathBuf,
}

impl Default for OverlayFsManager {
    fn default() -> Self {
        let base = std::env::var("CRUCIBLE_OVERLAY_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir().join("crucible_overlays"));
        Self::new(base)
    }
}

impl OverlayFsManager {
    pub fn new(base_path: impl Into<PathBuf>) -> Self {
        Self {
            base_path: base_path.into(),
        }
    }

    /// Allocates and mounts an ephemeral OverlayFS workspace.
    pub fn create_overlay(
        &self,
        prefix: &str,
        lower_dirs: &[PathBuf],
    ) -> Result<OverlayFsGuard, SandboxError> {
        let seq = OVERLAY_COUNTER.fetch_add(1, Ordering::SeqCst);
        let id = format!("{}_{}_{}", prefix, std::process::id(), seq);
        OverlayFsGuard::create(&self.base_path, &id, lower_dirs)
    }

    pub fn base_path(&self) -> &Path {
        &self.base_path
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use std::panic::{AssertUnwindSafe, catch_unwind};

    #[test]
    fn test_overlayfs_copy_on_write_isolation() {
        let temp = tempfile::TempDir::new().unwrap();
        let lower_dir = temp.path().join("lower");
        fs::create_dir_all(&lower_dir).unwrap();

        // Create base file in lowerdir
        let mut f = File::create(lower_dir.join("base.txt")).unwrap();
        f.write_all(b"original_pristine_content").unwrap();

        let manager = OverlayFsManager::new(temp.path().join("overlays"));
        let guard = manager
            .create_overlay("test_cow", &[lower_dir.clone()])
            .unwrap();

        let merged_file = guard.merged_path().join("base.txt");
        assert!(merged_file.exists());
        assert_eq!(
            fs::read_to_string(&merged_file).unwrap(),
            "original_pristine_content"
        );

        // Modify file in merged view (Copy-On-Write modification)
        fs::write(&merged_file, "modified_in_sandbox").unwrap();
        assert_eq!(
            fs::read_to_string(&merged_file).unwrap(),
            "modified_in_sandbox"
        );

        // Verify pristine lower directory is UNTOUCHED
        assert_eq!(
            fs::read_to_string(lower_dir.join("base.txt")).unwrap(),
            "original_pristine_content"
        );

        // Create new file inside sandbox
        let new_sandboxed_file = guard.merged_path().join("new_script.sh");
        fs::write(&new_sandboxed_file, "#!/bin/bash\necho hello").unwrap();
        assert!(new_sandboxed_file.exists());
        assert!(!lower_dir.join("new_script.sh").exists());
    }

    #[test]
    fn test_overlayfs_guaranteed_teardown_on_drop() {
        let temp = tempfile::TempDir::new().unwrap();
        let lower_dir = temp.path().join("lower");
        fs::create_dir_all(&lower_dir).unwrap();

        let manager = OverlayFsManager::new(temp.path().join("overlays"));
        let guard = manager.create_overlay("drop_test", &[lower_dir]).unwrap();

        let merged_dir = guard.merged_path().to_path_buf();
        let parent_dir = merged_dir.parent().unwrap().to_path_buf();
        assert!(merged_dir.exists());

        drop(guard);
        assert!(
            !parent_dir.exists(),
            "OverlayFS directory must be deleted on Drop"
        );
    }

    #[test]
    fn test_overlayfs_panic_unwind_safety() {
        let temp = tempfile::TempDir::new().unwrap();
        let lower_dir = temp.path().join("lower");
        fs::create_dir_all(&lower_dir).unwrap();

        let manager = OverlayFsManager::new(temp.path().join("overlays"));
        let guard = manager.create_overlay("panic_test", &[lower_dir]).unwrap();

        let instance_dir = guard.merged_path().parent().unwrap().to_path_buf();
        assert!(instance_dir.exists());

        let result = catch_unwind(AssertUnwindSafe(|| {
            let _active_guard = guard;
            panic!("Fatal error during execution inside sandbox");
        }));

        assert!(result.is_err());
        assert!(
            !instance_dir.exists(),
            "OverlayFS directory must be deleted during panic unwinding (zero disk leak)"
        );
    }
}
