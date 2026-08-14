use serde::{Deserialize, Serialize};
use std::env;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::{Span, info_span};

static COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TraceContext {
    pub version: String,
    pub trace_id: String,
    pub parent_span_id: Option<String>,
    pub span_id: String,
    pub trace_flags: String,
}

impl TraceContext {
    pub fn new_root() -> Self {
        let trace_id = generate_hex(16);
        let span_id = generate_hex(8);
        Self {
            version: "00".to_string(),
            trace_id,
            parent_span_id: None,
            span_id,
            trace_flags: "01".to_string(),
        }
    }

    pub fn parse_traceparent(header: &str) -> Option<Self> {
        let parts: Vec<&str> = header.trim().split('-').collect();
        if parts.len() != 4 {
            return None;
        }

        let version = parts[0];
        let trace_id = parts[1];
        let parent_span_id = parts[2];
        let trace_flags = parts[3];

        if version != "00"
            || trace_id.len() != 32
            || parent_span_id.len() != 16
            || trace_flags.len() != 2
        {
            return None;
        }

        let child_span_id = generate_hex(8);

        Some(Self {
            version: version.to_string(),
            trace_id: trace_id.to_string(),
            parent_span_id: Some(parent_span_id.to_string()),
            span_id: child_span_id,
            trace_flags: trace_flags.to_string(),
        })
    }

    pub fn from_env() -> Option<Self> {
        env::var("TRACEPARENT")
            .ok()
            .and_then(|val| Self::parse_traceparent(&val))
    }

    pub fn to_traceparent(&self) -> String {
        format!(
            "{}-{}-{}-{}",
            self.version, self.trace_id, self.span_id, self.trace_flags
        )
    }

    pub fn create_span(&self, name: &'static str) -> Span {
        info_span!(
            "crucible_trace",
            otel.name = name,
            trace_id = %self.trace_id,
            span_id = %self.span_id,
            parent_span_id = %self.parent_span_id.as_deref().unwrap_or("none"),
        )
    }
}

fn generate_hex(bytes: usize) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let count = COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id() as u128;

    let seed1 = now ^ ((pid << 32) | (count as u128));
    let seed2 = (now.rotate_left(17)) ^ ((count as u128).rotate_right(13));

    let mut hex = String::with_capacity(bytes * 2);
    let s1_hex = format!("{:016x}", seed1);
    let s2_hex = format!("{:016x}", seed2);
    let combined = format!("{}{}", s1_hex, s2_hex);

    for ch in combined.chars().take(bytes * 2) {
        hex.push(ch);
    }

    while hex.len() < bytes * 2 {
        hex.push('0');
    }

    hex
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_valid_traceparent() {
        let header = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
        let ctx = TraceContext::parse_traceparent(header).expect("valid traceparent");

        assert_eq!(ctx.version, "00");
        assert_eq!(ctx.trace_id, "4bf92f3577b34da6a3ce929d0e0e4736");
        assert_eq!(ctx.parent_span_id, Some("00f067aa0ba902b7".to_string()));
        assert_eq!(ctx.trace_flags, "01");
        assert_eq!(ctx.span_id.len(), 16);
    }

    #[test]
    fn test_parse_invalid_traceparent() {
        assert!(TraceContext::parse_traceparent("invalid").is_none());
        assert!(TraceContext::parse_traceparent("01-too-short-01").is_none());
        assert!(TraceContext::parse_traceparent("00-12345-67890-01").is_none());
    }

    #[test]
    fn test_to_traceparent_format() {
        let ctx = TraceContext {
            version: "00".to_string(),
            trace_id: "4bf92f3577b34da6a3ce929d0e0e4736".to_string(),
            parent_span_id: Some("00f067aa0ba902b7".to_string()),
            span_id: "a1b2c3d4e5f60718".to_string(),
            trace_flags: "01".to_string(),
        };

        assert_eq!(
            ctx.to_traceparent(),
            "00-4bf92f3577b34da6a3ce929d0e0e4736-a1b2c3d4e5f60718-01"
        );
    }
}
