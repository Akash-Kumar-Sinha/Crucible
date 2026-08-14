-- Migration 0001: Initial Crucible Persistence Schema
-- Supports durable Session, Turn, ToolCall, and Event Sourcing RunEvent tables

CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "agentState" TEXT NOT NULL DEFAULT 'awaiting_model',
    "modelSlug" TEXT NOT NULL DEFAULT 'nvidia/nemotron-3-nano-30b-a3b:free',
    "systemPrompt" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Turn" (
    "id" TEXT NOT NULL,
    "turnNumber" INTEGER NOT NULL,
    "sessionId" TEXT NOT NULL,
    "thought" TEXT,
    "modelOutput" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Turn_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Turn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ToolCall" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "stdout" TEXT,
    "stderr" TEXT,
    "output" JSONB,
    "error" JSONB,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolCall_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ToolCall_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "RunEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RunEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS "Session_status_idx" ON "Session"("status");
CREATE INDEX IF NOT EXISTS "Session_createdAt_idx" ON "Session"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "Turn_sessionId_turnNumber_key" ON "Turn"("sessionId", "turnNumber");
CREATE INDEX IF NOT EXISTS "Turn_sessionId_idx" ON "Turn"("sessionId");
CREATE INDEX IF NOT EXISTS "ToolCall_turnId_idx" ON "ToolCall"("turnId");
CREATE INDEX IF NOT EXISTS "ToolCall_name_idx" ON "ToolCall"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "RunEvent_sessionId_sequenceNumber_key" ON "RunEvent"("sessionId", "sequenceNumber");
CREATE INDEX IF NOT EXISTS "RunEvent_sessionId_idx" ON "RunEvent"("sessionId");
CREATE INDEX IF NOT EXISTS "RunEvent_eventType_idx" ON "RunEvent"("eventType");
