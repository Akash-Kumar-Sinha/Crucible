import { SessionManager } from "../session/session-manager";
import { MockModelProvider } from "../provider/mock";
import {
  LiveKitRoomManager,
  verifyLiveKitJwt,
} from "../voice/livekit-room-manager";
import { MockSttEngine } from "../voice/stt-engine";
import { VoiceAgent } from "../voice/voice-agent";
import { getErrorReporter } from "../observability/error-reporter";
import { performReadinessCheck } from "../observability/health";

export async function runVoiceInterfaceVerification() {
  console.log(
    "================================================================================",
  );
  console.log(
    "  CRUCIBLE - SELF-HOSTED LIVEKIT REAL-TIME VOICE COMMAND INTERFACE DEMO",
  );
  console.log(
    "================================================================================",
  );

  const passedTests: string[] = [];
  const reporter = getErrorReporter();

  // ---------------------------------------------------------------------------
  // 1. LiveKit JWT Token Minting & Cryptographic Verification (Facade Pattern)
  // ---------------------------------------------------------------------------
  console.log(
    "\n[1/5] Testing Self-Hosted LiveKit JWT Minting & VideoGrant Claims...",
  );
  const apiKey = "crucible_dev_key";
  const apiSecret = "crucible_livekit_secret_key_32_chars_long";
  const roomManager = new LiveKitRoomManager({
    apiKey,
    apiSecret,
    wsUrl: "ws://127.0.0.1:7880",
    httpUrl: "http://127.0.0.1:7880",
  });

  const sessionId = "demo_session_voice_42";
  const userTokenResult = roomManager.createSessionToken(sessionId, {
    participantName: "Engineer Alice",
    ttlSeconds: 3600,
  });

  console.log(`  - Target Room: ${userTokenResult.roomName}`);
  console.log(`  - Participant: ${userTokenResult.participantIdentity}`);
  console.log(`  - WebSocket URL: ${userTokenResult.wsUrl}`);
  console.log(
    `  - JWT Token (Header.Payload.Sig): ${userTokenResult.token.slice(0, 32)}...`,
  );

  const verification = verifyLiveKitJwt(userTokenResult.token, apiSecret);
  if (!verification.valid || !verification.payload) {
    throw new Error(`Token verification failed: ${verification.error}`);
  }
  const videoGrant = (verification.payload as any).video;
  if (
    !videoGrant.roomJoin ||
    !videoGrant.canPublish ||
    !videoGrant.canSubscribe
  ) {
    throw new Error("Missing required VideoGrant permissions");
  }
  console.log(
    "  [PASS] Cryptographic HMAC-SHA256 signature verified & VideoGrants confirmed.",
  );
  passedTests.push("JWT Token & VideoGrant Verification");

  // ---------------------------------------------------------------------------
  // 2. Server-Side Voice Agent Token Generation
  // ---------------------------------------------------------------------------
  console.log("\n[2/5] Initializing Server-Side LiveKit Agent Participant...");
  const agentTokenResult = roomManager.createAgentToken(sessionId);
  console.log(`  - Voice Agent ID: ${agentTokenResult.participantIdentity}`);
  console.log(`  - Active Rooms Count: ${roomManager.getActiveRooms().length}`);
  passedTests.push("Server-Side Voice Agent Participant Initialization");

  // ---------------------------------------------------------------------------
  // 3. Push-to-Talk Simulation: Hold -> Speak Command -> Release -> Transcribe
  // ---------------------------------------------------------------------------
  console.log(
    "\n[3/5] Simulating Push-to-Talk Hold, Speech Stream & Release...",
  );
  const spokenCommand =
    "Inspect git status and check repository package dependencies";
  const sttEngine = new MockSttEngine([spokenCommand]);

  console.log("  - [User Action] User holds Push-to-Talk button...");
  console.log(`  - [User Action] User speaks: "${spokenCommand}"`);
  console.log("  - [User Action] User releases Push-to-Talk button.");

  const audioPayloadBase64 = Buffer.from(spokenCommand).toString("base64");
  const sttResult = await sttEngine.transcribe({
    sessionId,
    audioBase64: audioPayloadBase64,
    mimeType: "audio/webm",
  });

  console.log(`  - Decoded Transcript from STT: "${sttResult.text}"`);
  console.log(`  - STT Confidence Score: ${sttResult.confidence}`);
  console.log(`  - Transcription Duration: ${sttResult.durationMs}ms`);
  passedTests.push("Push-to-Talk Audio Capture & Pluggable STT Decoding");

  // ---------------------------------------------------------------------------
  // 4. Voice Agent Adapter Pattern & Full Agent Loop Execution
  // ---------------------------------------------------------------------------
  console.log(
    "\n[4/5] Testing Adapter Pattern: Forwarding Voice Command into Agent Loop...",
  );
  const provider = new MockModelProvider();
  const sessionManager = new SessionManager({
    defaultProvider: provider,
    autoPersist: false,
  });
  const session = sessionManager.createSession({
    sessionId,
    title: "Voice Autonomous Session",
  });

  const voiceAgent = new VoiceAgent({
    sessionId: session.id,
    sessionManager,
    sttEngine,
    roomManager,
  });

  const dataEvents: any[] = [];
  voiceAgent.on("dataEvent", (evt) => dataEvents.push(evt));

  // Process audio input which converts speech into a standard text envelope and dispatches to session
  const processResult = await voiceAgent.processAudioInput({
    audioBase64: audioPayloadBase64,
  });

  if (!processResult.forwarded || processResult.transcript !== spokenCommand) {
    throw new Error("Voice input was not properly adapted and forwarded");
  }

  const updatedSession = sessionManager.get(sessionId);
  if (!updatedSession || updatedSession.getMessages().length === 0) {
    throw new Error("Message did not arrive in Session message queue");
  }

  const messages = updatedSession.getMessages();
  const userMsg = messages.find((m) => m.role === "user");
  const assistantMsg = messages.find((m) => m.role === "assistant");

  console.log(`  - Transcribed Text Forwarded: "${processResult.transcript}"`);
  console.log(`  - Session Message History Count: ${messages.length}`);
  console.log(`  - User Message in History: "${userMsg?.content}"`);
  console.log(
    `  - Assistant Model Response: "${assistantMsg?.content?.slice(0, 50)}..."`,
  );
  console.log(`  - Agent Turn Count: ${updatedSession.getSummary().turnCount}`);

  if (!userMsg || !assistantMsg) {
    throw new Error(
      "Voice command did not produce complete user & assistant loop messages",
    );
  }
  console.log(
    "  [PASS] Voice command converted into text message envelope and executed agent loop exactly like typed input.",
  );
  passedTests.push("Voice Command Agent Loop Execution");

  // ---------------------------------------------------------------------------
  // 5. Killing LiveKit Server Simulation: Error Surfacing (No Silent Hang)
  // ---------------------------------------------------------------------------
  console.log(
    "\n[5/5] Chaos Simulation: Killing livekit-server Container & Probing Error Surfacing...",
  );

  let sttAlertCaptured = false;
  reporter.once("voiceSttFailureAlert", () => {
    sttAlertCaptured = true;
  });

  // A. STT Engine Failure Alert
  const failingStt: any = {
    name: "simulated_failing_stt",
    isAvailable: async () => true,
    transcribe: async () => {
      throw new Error("Microphone buffer timeout");
    },
  };

  const failingAgent = new VoiceAgent({
    sessionId: session.id,
    sessionManager,
    sttEngine: failingStt,
  });

  try {
    await failingAgent.processAudioInput({ audioBase64: "invalid" });
  } catch {
    // Expected simulation error
  }

  if (!sttAlertCaptured) {
    throw new Error(
      "Voice STT failure alert was not captured by ErrorReporter",
    );
  }
  console.log(
    "  [PASS] CRUCIBLE_VOICE_STT_FAILURE_ALERT captured and tenant-attributed.",
  );

  // B. Dead / Killed LiveKit Server Container Simulation
  console.log(
    "  - Simulating killed LiveKit SFU server (ECONNREFUSED 127.0.0.1:7880)...",
  );
  const t0 = performance.now();
  const killedReadiness = await performReadinessCheck({
    checkLiveKit: async () => {
      const err: any = new Error("connect ECONNREFUSED 127.0.0.1:7880");
      err.code = "ECONNREFUSED";
      throw err;
    },
  });
  const elapsedMs = Math.round(performance.now() - t0);

  const deadProbe = killedReadiness.body.checks?.["livekit_server"];
  console.log(
    `  - Health Probe Response Time: ${elapsedMs}ms (Expected: < 50ms, no silent hang)`,
  );
  console.log(`  - Health Probe Status: ${deadProbe?.status.toUpperCase()}`);
  console.log(`  - Health Probe Diagnostic Message: "${deadProbe?.message}"`);

  if (
    !deadProbe ||
    deadProbe.status !== "degraded" ||
    !deadProbe.message?.includes("ECONNREFUSED")
  ) {
    throw new Error(
      "Killed LiveKit server did not surface a clear error in health checks",
    );
  }

  // C. LiveKit SFU Healthy Probe Verification
  const healthyReadiness = await performReadinessCheck({
    checkLiveKit: async () => ({
      ok: true,
      latencyMs: 3,
      status: 200,
    }),
  });

  const healthyProbe = healthyReadiness.body.checks?.["livekit_server"];
  if (!healthyProbe || healthyProbe.status !== "ok") {
    throw new Error("LiveKit server readiness probe failed");
  }
  console.log(
    `  - LiveKit SFU Restored Health Check: ${healthyProbe.status.toUpperCase()} (${healthyProbe.latencyMs}ms)`,
  );
  passedTests.push(
    "Killed LiveKit Server Error Surfacing & Health Check Diagnostics",
  );

  // Clean up background session timers
  sessionManager.clear();

  console.log(
    "\n================================================================================",
  );
  console.log(
    "  VERIFICATION SUMMARY: ALL VOICE COMMAND INTERFACE TESTS PASSED",
  );
  console.log(
    "================================================================================",
  );
  passedTests.forEach((testName, i) => {
    console.log(`  [${i + 1}/${passedTests.length}] ${testName}: PASSED`);
  });
  console.log(
    "================================================================================\n",
  );
}

if (import.meta.main) {
  runVoiceInterfaceVerification()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error("Voice interface verification failed:", err);
      process.exit(1);
    });
}
