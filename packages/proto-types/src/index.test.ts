import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import {
  findExecutorProtoPath,
  loadExecutorProtoDefinition,
  createExecutorClient,
  StreamType,
} from "./index";

describe("@crucible/proto-types", () => {
  it("should find and locate the executor.proto file", () => {
    const protoPath = findExecutorProtoPath();
    expect(typeof protoPath).toBe("string");
    expect(existsSync(protoPath)).toBe(true);
    expect(protoPath.endsWith("executor.proto")).toBe(true);
  });

  it("should load the protobuf definition without errors", () => {
    const protoDefinition = loadExecutorProtoDefinition() as Record<
      string,
      unknown
    >;
    const crucible = protoDefinition.crucible as
      Record<string, unknown> | undefined;
    const executor = crucible?.executor as Record<string, unknown> | undefined;
    const v1 = executor?.v1 as Record<string, unknown> | undefined;

    expect(protoDefinition).toBeDefined();
    expect(v1?.ExecutorService).toBeDefined();
  });

  it("should instantiate an ExecutorServiceClient", () => {
    const client = createExecutorClient("127.0.0.1:50051");
    expect(client).toBeDefined();
    expect(typeof client.Execute).toBe("function");
    expect(typeof client.StreamExecute).toBe("function");
    client.close();
  });

  it("should have valid StreamType enum values", () => {
    expect(StreamType.STREAM_TYPE_UNSPECIFIED).toBe(0);
    expect(StreamType.STREAM_TYPE_STDOUT).toBe(1);
    expect(StreamType.STREAM_TYPE_STDERR).toBe(2);
    expect(StreamType.STREAM_TYPE_COMPLETION).toBe(3);
  });
});
