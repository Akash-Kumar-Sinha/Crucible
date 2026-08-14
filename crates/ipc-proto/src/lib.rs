pub mod crucible {
    pub mod executor {
        pub mod v1 {
            tonic::include_proto!("crucible.executor.v1");
        }
    }
}

pub use crucible::executor::v1::*;
