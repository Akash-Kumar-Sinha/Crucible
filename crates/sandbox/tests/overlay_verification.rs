use crucible_sandbox::OverlayFsManager;
use std::fs::{self, File};
use std::io::Write;
use std::sync::Arc;
use tokio::time::Duration;

#[tokio::test]
async fn test_parallel_sandboxed_processes_cross_talk_isolation() {
    let temp = tempfile::TempDir::new().unwrap();
    let base_dir = temp.path().join("base_workspace");
    fs::create_dir_all(&base_dir).unwrap();

    let shared_filename = "data.txt";
    let initial_content = "ORIGINAL_BASE_DATA";
    let mut f = File::create(base_dir.join(shared_filename)).unwrap();
    f.write_all(initial_content.as_bytes()).unwrap();

    let manager = Arc::new(OverlayFsManager::new(temp.path().join("overlays")));

    let base_a = base_dir.clone();
    let base_b = base_dir.clone();
    let manager_a = Arc::clone(&manager);
    let manager_b = Arc::clone(&manager);

    // Process A task
    let task_a = tokio::spawn(async move {
        let guard_a = manager_a
            .create_overlay("parallel_a", std::slice::from_ref(&base_a))
            .unwrap();

        let file_path = guard_a.merged_path().join("data.txt");
        fs::write(&file_path, "WRITE_FROM_PROCESS_A").unwrap();

        tokio::time::sleep(Duration::from_millis(30)).await;

        let content = fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "WRITE_FROM_PROCESS_A");

        let instance_dir = guard_a.merged_path().parent().unwrap().to_path_buf();
        drop(guard_a);
        assert!(
            !instance_dir.exists(),
            "Instance directory A must be removed on Drop"
        );
    });

    // Process B task (concurrent)
    let task_b = tokio::spawn(async move {
        let guard_b = manager_b
            .create_overlay("parallel_b", std::slice::from_ref(&base_b))
            .unwrap();

        let file_path = guard_b.merged_path().join("data.txt");
        fs::write(&file_path, "WRITE_FROM_PROCESS_B").unwrap();

        tokio::time::sleep(Duration::from_millis(30)).await;

        let content = fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "WRITE_FROM_PROCESS_B");

        let instance_dir = guard_b.merged_path().parent().unwrap().to_path_buf();
        drop(guard_b);
        assert!(
            !instance_dir.exists(),
            "Instance directory B must be removed on Drop"
        );
    });

    let (res_a, res_b) = tokio::join!(task_a, task_b);
    res_a.unwrap();
    res_b.unwrap();

    // Verify pristine base file remains unchanged
    let base_content = fs::read_to_string(base_dir.join(shared_filename)).unwrap();
    assert_eq!(
        base_content, initial_content,
        "Base directory must never be mutated by parallel runs"
    );
}
