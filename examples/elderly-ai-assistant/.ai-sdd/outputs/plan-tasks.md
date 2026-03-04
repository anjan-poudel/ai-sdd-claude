# L3 Task Breakdown — Elderly AI Assistant

**Project:** Elderly AI Assistant
**Version:** 1.0 (MVP)
**Document:** Implementation Task Plan (L3)
**Status:** Draft
**Date:** 2026-03-04
**Author:** Lead Engineer (ai-sdd)
**Inputs:** define-requirements.md, design-l1.md, design-l2.md, review-l2.md, security-design-review.md

---

## 1. Overview

This document breaks the L2 component design into concrete, scoped implementation tasks. Each task has:

- Unique task ID
- Scope statement
- Acceptance criteria (measurable, test-verifiable)
- Dependencies on other tasks
- Effort estimate (S = 1–2 days, M = 3–5 days, L = 6–10 days, XL = 10+ days)
- Risk flags
- Security review conditions (where raised by security-design-review.md)

**Total implementation tasks: 32**

**Platforms:** iOS (Swift) and Android (Kotlin) developed in parallel for all shared-boundary components. Shared logic is extracted into a Kotlin Multiplatform (KMP) or C/C++ shared library where the design specifies cross-platform reuse (llama.cpp, openWakeWord, whisper.cpp, libsignal).

---

## 2. Summary Table

| Task ID | Name | Effort | Risk | Depends On |
|---------|------|--------|------|------------|
| T-001 | Repository and CI/CD scaffolding | S | LOW | — |
| T-002 | EncryptedLocalStorage — iOS | M | MEDIUM | T-001 |
| T-003 | EncryptedLocalStorage — Android | M | MEDIUM | T-001 |
| T-004 | ObservabilityBus + LogSanitiser | S | LOW | T-001 |
| T-005 | WakeWordDetector (openWakeWord) — iOS | M | MEDIUM | T-002, T-004 |
| T-006 | WakeWordDetector (openWakeWord) — Android | M | MEDIUM | T-003, T-004 |
| T-007 | AudioSessionManager — iOS | M | MEDIUM | T-002, T-004 |
| T-008 | AudioSessionManager — Android | M | MEDIUM | T-003, T-004 |
| T-009 | STTEngine (Whisper.cpp) — iOS | M | MEDIUM | T-007, T-004 |
| T-010 | STTEngine (Whisper.cpp) — Android | M | MEDIUM | T-008, T-004 |
| T-011 | AccentTuner — iOS + Android | M | MEDIUM | T-009, T-010, T-002, T-003 |
| T-012 | TTSEngine (Coqui/Piper) — iOS | M | MEDIUM | T-007, T-004 |
| T-013 | TTSEngine (Coqui/Piper) — Android | M | MEDIUM | T-008, T-004 |
| T-014 | VoiceBiometricAuth (PAD-required) — iOS | L | HIGH | T-002, T-007, T-004 |
| T-015 | VoiceBiometricAuth (PAD-required) — Android | L | HIGH | T-003, T-008, T-004 |
| T-016 | PinFallbackAuth (Argon2id) — iOS + Android | S | MEDIUM | T-002, T-003 |
| T-017 | AuthCoordinator — iOS + Android | S | MEDIUM | T-014, T-015, T-016 |
| T-018 | LlamaInferenceEngine (llama.cpp) — iOS | L | HIGH | T-002, T-004 |
| T-019 | LlamaInferenceEngine (llama.cpp) — Android | L | HIGH | T-003, T-004 |
| T-020 | InputSanitiser + ContextWindowManager | S | MEDIUM | T-018, T-019 |
| T-021 | IntentClassifier + EntityExtractor | M | MEDIUM | T-020 |
| T-022 | VoiceSessionCoordinator — iOS | M | HIGH | T-005, T-009, T-012, T-017, T-021, T-007 |
| T-023 | VoiceSessionCoordinator — Android | M | HIGH | T-006, T-010, T-013, T-017, T-021, T-008 |
| T-024 | HealthMonitorService — iOS | M | HIGH | T-002, T-004 |
| T-025 | HealthMonitorService — Android | M | HIGH | T-003, T-004 |
| T-026 | AlertEvaluator + EmergencyDispatcher — iOS | M | HIGH | T-024, T-012, T-004 |
| T-027 | AlertEvaluator + EmergencyDispatcher — Android | M | HIGH | T-025, T-013, T-004 |
| T-028 | MedicationScheduler + FamilyNotifier — iOS | M | HIGH | T-002, T-004 |
| T-029 | MedicationScheduler + FamilyNotifier — Android | M | HIGH | T-003, T-004 |
| T-030 | SignalProtocolClient + RelayWebSocketClient | L | HIGH | T-002, T-003, T-004 |
| T-031 | ConfigPayloadDecryptor + ConfigSchemaValidator + ConfigApplicator | M | MEDIUM | T-030, T-024, T-025, T-028, T-029, T-005, T-006 |
| T-032 | Companion App (iOS + Android) | L | MEDIUM | T-030 |

---

## 3. Critical Path

```
T-001 → T-002/T-003 → T-007/T-008
                    → T-004
                    → T-014/T-015 → T-017 → T-022/T-023
T-001 → T-002/T-003 → T-005/T-006 → T-022/T-023
T-001 → T-002/T-003 → T-009/T-010 → T-022/T-023
T-001 → T-002/T-003 → T-018/T-019 → T-020 → T-021 → T-022/T-023
T-001 → T-002/T-003 → T-024/T-025 → T-026/T-027   [SAFETY CRITICAL — independent of LLM path]
T-001 → T-002/T-003 → T-028/T-029                  [SAFETY CRITICAL — independent of LLM path]
T-001 → T-002/T-003 → T-030 → T-031
```

**Longest chain (critical path through LLM + voice session):**
T-001 → T-002 → T-018 → T-020 → T-021 → T-022 = ~27 days iOS (sequential estimate)

**Safety-critical path (must be deliverable independently):**
T-001 → T-002 → T-024 → T-026 = ~12 days iOS (sequential estimate)

**Parallelisation opportunity:** iOS and Android streams can be developed simultaneously, and safety-critical services (T-024–T-029) can be developed in parallel with the LLM/voice pipeline.

---

## 4. Detailed Task Specifications

---

### T-001: Repository and CI/CD Scaffolding

**Effort:** S
**Risk:** LOW
**Depends On:** —

**Scope:**
Set up the iOS (Xcode / Swift Package Manager) and Android (Gradle / Kotlin) project repositories. Configure CI/CD pipelines. Establish shared project structure for cross-platform components (llama.cpp, whisper.cpp, openWakeWord, libsignal via C/C++ or Kotlin Multiplatform). Define code style and linting rules.

**Acceptance Criteria:**
- [ ] iOS project builds on CI (zero warnings in strict mode).
- [ ] Android project builds on CI (zero warnings, `ktlint` passes).
- [ ] Both projects run unit tests on CI with pass/fail gating.
- [ ] Pre-commit hooks enforce `swiftformat` (iOS) and `ktlint` (Android).
- [ ] A `README` documents how to build and run each project locally.
- [ ] CI secret scanning is enabled; no secrets committed in first PR.

---

### T-002: EncryptedLocalStorage — iOS

**Effort:** M
**Risk:** MEDIUM
**Depends On:** T-001

**Scope:**
Implement `EncryptedLocalStorage` protocol for iOS using Core Data with `NSFileProtectionComplete`. Key-value store backed by Core Data entities. Generic typed read/write/delete interface matching L2 §9.

**Acceptance Criteria:**
- [ ] All three methods (`write`, `read`, `delete`) are implemented and match the protocol in L2 §9.
- [ ] Unit test: data written survives app restart (via mock persistence layer).
- [ ] Unit test: write failure returns `Failure(.EncryptedWriteFailed)` — not a silent success.
- [ ] Unit test: read failure returns `Failure(.EncryptedReadFailed)`.
- [ ] Integration test: `NSFileProtectionComplete` attribute is set on the Core Data store file.
- [ ] Security test: store file is unreadable without device unlock (automated test using XCTest with device lock state where possible; manual test evidence required otherwise).
- [ ] No plaintext data visible in `~/Library` or sandbox directories in debug builds.

---

### T-003: EncryptedLocalStorage — Android

**Effort:** M
**Risk:** MEDIUM
**Depends On:** T-001

**Scope:**
Implement `EncryptedLocalStorage` for Android using Room with SQLCipher for data entities and `EncryptedSharedPreferences` for preferences. Matches the protocol interface in L2 §9.

**Acceptance Criteria:**
- [ ] All three methods implemented and match the interface in L2 §9.
- [ ] Unit test: data written survives process kill + relaunch.
- [ ] Unit test: write failure returns typed `StorageError` — not silent.
- [ ] Integration test: Room database file uses SQLCipher encryption (inspect DB file bytes; must not be readable as plaintext SQLite).
- [ ] `EncryptedSharedPreferences` preference keys and values are not visible in plaintext in app data directory.

---

### T-004: ObservabilityBus + LogSanitiser

**Effort:** S
**Risk:** LOW
**Depends On:** T-001

**Scope:**
Implement `ObservabilityBus` protocol and `LogSanitiser` wrapper as described in L2 §2.3. The sanitiser must strip PII patterns before any event is written. Implement for both iOS and Android (shared logic extractable to a shared module).

**Acceptance Criteria:**
- [ ] `ObservabilityEvent` struct/data class matches L2 §2.3 schema exactly.
- [ ] `LogSanitiser` wraps `ObservabilityBus` at emission — no component bypasses it.
- [ ] Unit test: an event containing a mock health value (e.g. "98.6") is redacted before emission.
- [ ] Unit test: an event containing a mock contact name is redacted before emission.
- [ ] Unit test: valid non-PII fields (component name, eventType, durationMs, outcome, errorCode) pass through unchanged.
- [ ] All sanitisation rules enumerated in a unit-testable allowlist (not ad-hoc regex per component).

---

### T-005: WakeWordDetector (openWakeWord) — iOS

**Effort:** M
**Risk:** MEDIUM
**Depends On:** T-002, T-004

**Scope:**
Integrate openWakeWord model into iOS using CoreML. Implement `WakeWordDetector` protocol from L2 §3.1. Dedicated audio thread processing 80 ms frames. CoreML inference < 10 ms per frame. CPU target ≤ 3% continuous. Wake word model shipped as downloadable asset (not embedded in app binary per L2 §14 risk note).

**Acceptance Criteria:**
- [ ] Protocol implementation matches L2 §3.1 interface exactly (`start`, `stop`, `reloadModel`, `onDetected`).
- [ ] Unit test: `start()` with a missing model returns `Failure(.WakeWordModelLoadFailed)`.
- [ ] Unit test: `reloadModel()` with a valid model path succeeds and `onDetected` fires on next mock detection.
- [ ] Performance test: CoreML inference time measured at < 10 ms per 80 ms audio frame on iPhone 12 device.
- [ ] Performance test: CPU usage during continuous detection ≤ 3% (measured via Instruments in a 60-second test run).
- [ ] Integration test: when wake word is detected, `onDetected` callback fires within 1000 ms (NFR-006 wake-word activation latency).
- [ ] Observability events (`wake_word.started`, `wake_word.stopped`, `wake_word.detected`, `wake_word.model_reload_success`, `wake_word.model_reload_failed`) emitted via `ObservabilityBus` in all relevant code paths.
- [ ] Model download-on-first-launch logic implemented. Fallback to manual mic activation if download fails.

---

### T-006: WakeWordDetector (openWakeWord) — Android

**Effort:** M
**Risk:** MEDIUM
**Depends On:** T-003, T-004

**Scope:**
Integrate openWakeWord model into Android using TFLite. Same interface and performance targets as T-005.

**Acceptance Criteria:**
- [ ] Same functional acceptance criteria as T-005, adapted for TFLite and Android audio APIs.
- [ ] Performance test: TFLite inference < 10 ms per frame on Android mid-range reference device.
- [ ] `AudioRecord` with correct sample rate (16 kHz) and buffer size configured correctly.
- [ ] Model download-on-first-launch logic implemented with fallback.

---

### T-007: AudioSessionManager — iOS

**Effort:** M
**Risk:** MEDIUM
**Depends On:** T-002, T-004

**Scope:**
Implement `AudioSessionManager` protocol for iOS using `AVAudioSession`. Implement the silent background audio loop (1 s muted) for wake-word-while-locked support. Coordinate session state transitions between wake word, capture (STT), and playback (TTS) modes. Handle `AVAudioSession` interruptions (phone calls, alarms).

**Acceptance Criteria:**
- [ ] Protocol matches L2 §3.4 interface exactly.
- [ ] Integration test: calling `activateForCapture()` after `activateForWakeWord()` transitions session without error.
- [ ] Integration test: an audio session interruption (mocked via notification) triggers stop → wait → restart correctly.
- [ ] Integration test: silent background audio loop is started on first foreground and never stopped while wake word is enabled.
- [ ] Unit test: `requestMicrophoneAccess()` denied returns `Failure(.MicrophonePermissionDenied)`.
- [ ] Observability events emitted for key transitions.
- [ ] No other component starts background audio — `AudioSessionManager` is the sole owner (enforced by review; comment in code makes this explicit).

---

### T-008: AudioSessionManager — Android

**Effort:** M
**Risk:** MEDIUM
**Depends On:** T-003, T-004

**Scope:**
Implement `AudioSessionManager` for Android using `AudioManager`. Handle `ACTION_AUDIO_BECOMING_NOISY` and `AudioFocusRequest` for TTS/STT modes. Foreground service required for continuous audio processing.

**Acceptance Criteria:**
- [ ] Protocol matches L2 §3.4 interface exactly.
- [ ] Integration test: `AudioFocusRequest` is requested for capture and playback modes.
- [ ] Integration test: audio interruption (mocked `AUDIO_BECOMING_NOISY`) pauses wake word detection and resumes within 2 seconds.
- [ ] Foreground service for continuous background audio declared in AndroidManifest and notification shown.
- [ ] Unit test: microphone permission denied returns `Failure(.MicrophonePermissionDenied)`.

---

### T-009: STTEngine (Whisper.cpp) — iOS

**Effort:** M
**Risk:** MEDIUM
**Depends On:** T-007, T-004

**Scope:**
Integrate whisper.cpp for on-device STT on iOS via CoreML-accelerated inference. Implement `STTEngine` protocol from L2 §3.2. Accent adapter loading as delta weights. Enforce 2000 ms timeout (NFR-001). Apply Nepali → English confidence-based fallback (L2 §3.2).

**Acceptance Criteria:**
- [ ] Protocol matches L2 §3.2 interface exactly (`transcribe`, `loadAccentAdapter`).
- [ ] Performance test: Whisper-small transcription ≤ 2000 ms P95 on iPhone 12 for a 5-second audio clip.
- [ ] Unit test: transcription timeout (mocked) returns `Failure(.STTTimeout)`.
- [ ] Unit test: low confidence (< 0.5) returns `STTResult` with `confidenceScore` flagged, no error.
- [ ] Unit test: Nepali confidence < 0.6 with fallback enabled → returns higher-confidence result between Nepali and English runs.
- [ ] Integration test: accent adapter loaded from `EncryptedLocalStorage` and applied to next transcription.
- [ ] Observability events emitted: `stt.started`, `stt.completed`, `stt.timeout`, `stt.accent_adapter_loaded`. No transcript text in any event.

---

### T-010: STTEngine (Whisper.cpp) — Android

**Effort:** M
**Risk:** MEDIUM
**Depends On:** T-008, T-004

**Scope:**
Same as T-009, using TFLite for Android.

**Acceptance Criteria:**
- [ ] Same functional acceptance criteria as T-009, adapted for TFLite on Android.
- [ ] Performance test on Android reference device: ≤ 2000 ms P95 for Whisper-small.

---

### T-011: AccentTuner — iOS + Android

**Effort:** M
**Risk:** MEDIUM
**Depends On:** T-009, T-010, T-002, T-003

**Scope:**
Implement `AccentTuner` protocol from L2 §3.5. Background batch training from enrolled voice samples (minimum 20 utterances). Raw audio samples deleted immediately after training. Adapter stored in `EncryptedLocalStorage`. Progressive progress reporting via callback.

**Acceptance Criteria:**
- [ ] Protocol matches L2 §3.5 interface exactly (`enrol`, `update`, `currentAdapterVersion`).
- [ ] Unit test: fewer than 20 samples returns `Failure(.insufficientSamples(required: 20, provided: N))`.
- [ ] Integration test: 20+ samples provided → adapter written to `EncryptedLocalStorage` → `STTEngine.loadAccentAdapter()` called with new adapter path.
- [ ] Privacy test: raw audio sample buffers are zeroed/deallocated before `enrol()` returns.
- [ ] Unit test: training failure retains previous adapter version (no regression).
- [ ] Progress callback fires at reasonable intervals during training.

---

### T-012: TTSEngine (Coqui/Piper) — iOS

**Effort:** M
**Risk:** MEDIUM
**Depends On:** T-007, T-004

**Scope:**
Integrate Coqui TTS or Piper for on-device TTS on iOS. Implement `TTSEngine` protocol from L2 §3.3. Priority queue handling (`normal`, `high`, `emergency`). Emergency TTS must always succeed — fallback to `AVSpeechSynthesizer` if Coqui/Piper fails.

**Acceptance Criteria:**
- [ ] Protocol matches L2 §3.3 interface exactly (`speak`, `interrupt`, `configure`).
- [ ] Unit test: `speak(..., priority: .emergency)` with mocked render failure falls back to `AVSpeechSynthesizer` and succeeds.
- [ ] Unit test: `speak(..., priority: .high)` interrupts a currently queued `normal` item.
- [ ] Unit test: `speak(..., priority: .emergency)` interrupts all items including a playing `high` item.
- [ ] Unit test: Nepali TTS failure → retry with English TTS → `tts.fallback_to_english` event emitted.
- [ ] Observability events emitted: `tts.started`, `tts.completed`, `tts.interrupted`, `tts.render_failed`, `tts.fallback_to_english`.
- [ ] Silent failure for emergency TTS is a blocking test failure (emergency announcement MUST play).

---

### T-013: TTSEngine (Coqui/Piper) — Android

**Effort:** M
**Risk:** MEDIUM
**Depends On:** T-008, T-004

**Scope:**
Same as T-012. Fallback to Android `TextToSpeech` API for emergency announcements.

**Acceptance Criteria:**
- [ ] Same as T-012, adapted for Android. `TextToSpeech` API used as fallback for emergency path.

---

### T-014: VoiceBiometricAuth — iOS

**Effort:** L
**Risk:** HIGH (SECURITY-DESIGN-REVIEW BLOCKER: liveness detection required before implementation)
**Depends On:** T-002, T-007, T-004

**Scope:**
Implement `VoiceBiometricAuth` protocol from L2 §6.1. ECAPA-TDNN speaker embedding stored in iOS Secure Enclave. Raw audio samples deleted post-enrolment. Three-failure lockout. **SECURITY BLOCKER from security-design-review.md THREAT-001:** liveness detection (PAD) MUST be integrated before this task is considered STARTED. Confirm selected ECAPA-TDNN variant includes PAD or integrate AASIST model.

**Pre-condition (BLOCKER):**
Before T-014 can begin, the implementing team must document (in a design note reviewed by the security reviewer) which PAD approach is being used: (a) ECAPA-TDNN variant with built-in PAD, or (b) AASIST-based separate anti-spoofing model.

**Acceptance Criteria:**
- [ ] Protocol matches L2 §6.1 interface exactly (`enrol`, `verify`, `deleteProfile`, `enrolmentStatus`).
- [ ] Security test: PAD/liveness detection test — a recorded voice replay (test fixture) is rejected by the system with `passed: false` or `VerificationFailed`.
- [ ] Integration test: embedding stored as opaque blob in Secure Enclave (verify using `kSecAttrTokenIDSecureEnclave`).
- [ ] Privacy test: raw audio samples (`AudioBuffer` instances) are deallocated before `enrol()` returns (memory inspection or allocation test).
- [ ] Unit test: `BiometricAuthSession` — three consecutive failures return `.lockedOut`.
- [ ] Unit test: similarity below threshold returns `VerificationResult(passed: false)`.
- [ ] Observability events emitted: `biometric.enrol_started`, `biometric.enrol_completed`, `biometric.verify_started`, `biometric.verify_passed`, `biometric.verify_failed`, `biometric.lockout_triggered`, `biometric.profile_deleted`. No similarity scores or audio data in any event.
- [ ] `SecureStorageUnavailable` → surface to user and disable sensitive commands (tested via mock).

---

### T-015: VoiceBiometricAuth — Android

**Effort:** L
**Risk:** HIGH (same SECURITY BLOCKER as T-014)
**Depends On:** T-003, T-008, T-004

**Scope:**
Same as T-014 using Android Keystore for embedding storage.

**Pre-condition (BLOCKER):** Same PAD design note requirement as T-014.

**Acceptance Criteria:**
- [ ] Same acceptance criteria as T-014, adapted for Android Keystore.
- [ ] Integration test: embedding stored using `KeyPairGenerator` with `AndroidKeyStore` provider.

---

### T-016: PinFallbackAuth — iOS + Android

**Effort:** S
**Risk:** MEDIUM
**Depends On:** T-002, T-003

**Scope:**
Implement `PinFallbackAuth` protocol from L2 §6.2. Argon2id (64 MB, 3 iterations, parallelism 4, 16-byte random salt, 32-byte output). On Android < API 29: bouncy castle / libsodium JNI wrapper (per L2 §14 risk). Store `PinCredential` in `EncryptedLocalStorage`.

**Acceptance Criteria:**
- [ ] Protocol matches L2 §6.2 interface exactly (`setPin`, `verify`, `deletePin`).
- [ ] Unit test: `setPin()` hashes with Argon2id — raw PIN is not present in `EncryptedLocalStorage` output (inspect stored bytes).
- [ ] Unit test: `verify()` with correct PIN returns `success(true)`.
- [ ] Unit test: `verify()` with wrong PIN returns `success(false)` (not an error).
- [ ] Unit test: `verify()` after `deletePin()` returns `Failure(.SecureStorageUnavailable)` or appropriate not-found error.
- [ ] Android test: Argon2id works on API 28 emulator (via JNI fallback).
- [ ] Observability events: `pin.set`, `pin.verify_passed`, `pin.verify_failed`, `pin.deleted`. No PIN values or hashes in events.

---

### T-017: AuthCoordinator — iOS + Android

**Effort:** S
**Risk:** MEDIUM
**Depends On:** T-014, T-015, T-016

**Scope:**
Implement `AuthCoordinator` orchestrating the biometric → PIN fallback → re-enrolment prompt flow from L2 §6.3.

**Acceptance Criteria:**
- [ ] Unit test: biometric success on first attempt → command executed, no PIN presented.
- [ ] Unit test: biometric fails twice → TTS "Please try again" plays twice → third failure → `PinFallbackAuth` presented.
- [ ] Unit test: biometric lockout → PIN pass → command executed → re-enrolment prompt triggered.
- [ ] Unit test: biometric lockout → PIN fail → deny → no command executed.
- [ ] Integration test: full flow from voice command to `execute command` through happy path and failure path.

---

### T-018: LlamaInferenceEngine — iOS

**Effort:** L
**Risk:** HIGH
**Depends On:** T-002, T-004

**Scope:**
Integrate llama.cpp for on-device LLaMA 3.2 3B Q4_K_M GGUF inference on iOS. Implement `LlamaInferenceEngine` protocol from L2 §4.1. Background model loading at launch. iOS memory management (unload on level-2 memory warning). Verify RAM footprint ≤ 2100 MB (NFR requirement).

**Acceptance Criteria:**
- [ ] Protocol matches L2 §4.1 interface exactly (`load`, `unload`, `infer`, `isLoaded`, `memoryUsageMB`).
- [ ] Performance test: inference (30-token prompt, 50-token response) ≤ 3500 ms P95 on iPhone 12 (NFR-002).
- [ ] Performance test: model RAM footprint ≤ 2100 MB after `load()`.
- [ ] Unit test: `infer()` when `isLoaded == false` returns `Failure(.ModelNotLoaded)`.
- [ ] Unit test: inference timeout (mocked) returns `Failure(.InferenceTimeout)`.
- [ ] Unit test: `ContextWindowOverflow` → trim oldest messages → retry once.
- [ ] Integration test: iOS level-2 memory warning (mocked) triggers `unload()`.
- [ ] Integration test: reload after unload succeeds within reasonable latency.
- [ ] Safety test: `LlamaInferenceEngine` import is NOT present in `EmergencyDispatcher`, `HealthMonitorService`, or `MedicationScheduler` (enforced by build target separation).
- [ ] Observability events emitted as specified in L2 §4.1.

---

### T-019: LlamaInferenceEngine — Android

**Effort:** L
**Risk:** HIGH
**Depends On:** T-003, T-004

**Scope:**
Same as T-018 for Android. Runtime memory check before loading: decline load if available RAM < 2.5 GB (L2 §14 risk mitigation). Show in-app notice.

**Acceptance Criteria:**
- [ ] Same as T-018, adapted for Android.
- [ ] Unit test: available RAM < 2.5 GB at load time → `load()` returns failure with user-facing in-app notice.

---

### T-020: InputSanitiser + ContextWindowManager

**Effort:** S
**Risk:** MEDIUM
**Depends On:** T-018, T-019

**Scope:**
Implement `InputSanitiser` (quarantine and standard levels) and `ContextWindowManager` from L2 §4.1. Sanitisation blocklist: model template tokens, known adversarial patterns, system prompt overrides, role-marker tokens. Max input 2000 chars. Context window budget enforced as per L2 §4.1.

**Acceptance Criteria:**
- [ ] `InputSanitiser.sanitise(.quarantine)` blocks all INST tokens, system/user/assistant role markers, role-override patterns.
- [ ] Unit test: 50 adversarial input fixtures (OWASP LLM prompt injection list) are all rejected by `.quarantine` sanitisation.
- [ ] Unit test: standard control characters stripped by `.standard` level.
- [ ] Unit test: input > 2000 chars is truncated to 2000 chars.
- [ ] Unit test: `ContextWindowManager.trimContext()` removes oldest messages first when context exceeds budget.
- [ ] Unit test: system prompt budget ≤ 512 tokens enforced.
- [ ] Integration test: all external inputs (voice transcripts, calendar data, contact names) pass through `sanitise(.quarantine)` before reaching `LlamaInferenceEngine.infer()` — verified by test that bypasses sanitiser and is blocked.

---

### T-021: IntentClassifier + EntityExtractor

**Effort:** M
**Risk:** MEDIUM
**Depends On:** T-020

**Scope:**
Implement `IntentClassifier` and `EntityExtractor` as prompt-engineering layers over `LlamaInferenceEngine`, as specified in L2 §4.2. JSON-schema-based response parsing. Both components use `InputSanitiser.sanitise(.quarantine)` before LLM call.

**Acceptance Criteria:**
- [ ] Unit test: "Call [name] on Messenger" → `CALL_CONTACT` intent with `contact_name` entity extracted.
- [ ] Unit test: "Remind me to take my medication at 8 PM" → `SET_REMINDER` intent with `time` entity.
- [ ] Unit test: "Check my heart rate" → `HEALTH_QUERY` intent.
- [ ] Unit test: malformed LLM JSON response handled gracefully — no exception, fallback to `GENERAL_CONVERSATION`.
- [ ] Unit test: input passes through `sanitise(.quarantine)` before `infer()` — verified via mock.
- [ ] Integration test: end-to-end from raw transcript → intent → entity with real llama.cpp inference (marked as slow test, run nightly only).

---

### T-022: VoiceSessionCoordinator — iOS

**Effort:** M
**Risk:** HIGH
**Depends On:** T-005, T-009, T-012, T-017, T-021, T-007

**Scope:**
Implement `VoiceSessionCoordinator` FSM from L2 §3.6 for iOS. States: IDLE → LISTENING → TRANSCRIBING → AUTHENTICATING → PROCESSING → RESPONDING → IDLE. Error recovery paths, timeout handling, TTS "sorry" messages.

**Acceptance Criteria:**
- [ ] State machine transitions match L2 §3.6 exactly (tested via unit test for each transition).
- [ ] Unit test: any failure in TRANSCRIBING → IDLE + TTS "sorry" message.
- [ ] Unit test: AUTHENTICATING failure after 3 attempts → PIN fallback.
- [ ] Unit test: PROCESSING LLM timeout > 3500 ms → TTS "still thinking" → retry once → if second timeout → IDLE.
- [ ] Integration test: full happy-path voice session from wake-word detection to TTS response and return to IDLE.
- [ ] Integration test: sensitive command → authentication gate fires before PROCESSING.
- [ ] Integration test: emergency announcement (`TTSPriority.emergency`) interrupts an active RESPONDING state.

---

### T-023: VoiceSessionCoordinator — Android

**Effort:** M
**Risk:** HIGH
**Depends On:** T-006, T-010, T-013, T-017, T-021, T-008

**Scope:**
Same as T-022 for Android.

**Acceptance Criteria:**
- [ ] Same as T-022, adapted for Android.

---

### T-024: HealthMonitorService — iOS

**Effort:** M
**Risk:** HIGH
**Depends On:** T-002, T-004

**Scope:**
Implement `HealthMonitorService` for iOS using HealthKit `HKObserverQuery` (push-based) + `BGProcessingTask` (periodic fallback). Poll at configurable interval (default 30 s). Evaluate against `HealthThreshold` list. No LLM dependency.

**Acceptance Criteria:**
- [ ] Protocol matches L2 §5.1 interface exactly.
- [ ] Integration test: health permission revoked (mocked) → service stops → `health_monitor.permission_revoked` event emitted → voice announcement triggered → family notification triggered. Failure must NOT be silent.
- [ ] Unit test: threshold breach detected → `AlertEvaluator.evaluate()` called with correct `ThresholdBreach` data.
- [ ] Unit test: `updateThresholds()` called by `ConfigApplicator` — next evaluation uses updated thresholds.
- [ ] Integration test: `BGProcessingTask` fallback fires when `HKObserverQuery` delivers no update within interval (use mock time).
- [ ] Observability events emitted: no health metric values in any event (only `metric_name_only`).
- [ ] Build test: `LlamaInferenceEngine` is NOT imported in `HealthMonitorService` (build target isolation).

---

### T-025: HealthMonitorService — Android

**Effort:** M
**Risk:** HIGH
**Depends On:** T-003, T-004

**Scope:**
Same as T-024 using Health Connect `PassiveListenerService`. No LLM dependency.

**Acceptance Criteria:**
- [ ] Same as T-024, adapted for Android Health Connect API.
- [ ] `PassiveListenerService` declared in `AndroidManifest` with correct permissions.
- [ ] Build test: `LlamaInferenceEngine` NOT imported.

---

### T-026: AlertEvaluator + EmergencyDispatcher — iOS

**Effort:** M
**Risk:** HIGH
**Depends On:** T-024, T-012, T-004

**Scope:**
Implement `AlertEvaluator` (deduplication logic) and `EmergencyDispatcher` from L2 §5.2–5.3 for iOS. Full emergency sequence: TTS announcement (emergency priority) → 30-second countdown → CallKit call + family notification. `CancelListenerService` for keyword cancellation. No LLM dependency.

**Acceptance Criteria:**
- [ ] Protocol matches L2 §5.2–5.3 interfaces exactly.
- [ ] Unit test: same metric breach within 5 minutes is suppressed.
- [ ] Unit test: breach while countdown already active for same metric is suppressed.
- [ ] Integration test: full emergency sequence — TTS announcement plays → countdown starts → at expiry `CallKit.placeCall()` invoked → `FamilyNotifier.notifyAll()` invoked.
- [ ] Integration test: "Cancel" keyword during countdown → timer cancelled → TTS confirmation → no call placed.
- [ ] Integration test: `EmergencyCallFailed` on first attempt → retry after 3 s → if still fails → TTS manual instruction → family notification STILL sent.
- [ ] Integration test: `TTSEngine` failure for emergency announcement → platform-native `AVSpeechSynthesizer` fallback activated. Silent emergency announcement failure is a blocking test failure.
- [ ] Performance test: from threshold breach detection to emergency announcement start ≤ 3000 ms (NFR).
- [ ] Build test: `LlamaInferenceEngine` NOT imported in `EmergencyDispatcher` or `CancelListenerService`.

---

### T-027: AlertEvaluator + EmergencyDispatcher — Android

**Effort:** M
**Risk:** HIGH
**Depends On:** T-025, T-013, T-004

**Scope:**
Same as T-026 for Android. Use `TelephonyManager` / `Intent.ACTION_CALL` for emergency call. Android `TextToSpeech` as emergency TTS fallback.

**Acceptance Criteria:**
- [ ] Same as T-026, adapted for Android. `TextToSpeech` used as fallback.
- [ ] Emergency service runs in isolated process/service (declared in `AndroidManifest` with `android:process`).

---

### T-028: MedicationScheduler + FamilyNotifier — iOS

**Effort:** M
**Risk:** HIGH
**Depends On:** T-002, T-004

**Scope:**
Implement `MedicationScheduler` from L2 §5.4 for iOS. Persist each `ScheduledReminder` to `EncryptedLocalStorage` BEFORE setting OS alarm. Use `BGTaskScheduler` + local notification. Escalation: re-fire every 12 min up to 5 times; missed dose triggers `FamilyNotifier`. Implement `FamilyNotifier` (APNs for iOS) per L2 §5.5.

**Acceptance Criteria:**
- [ ] Protocol matches L2 §5.4–5.5 interface exactly.
- [ ] Integration test: reminder persisted to `EncryptedLocalStorage` before local notification scheduled (fail if storage write fails without scheduling).
- [ ] Unit test: `ReminderPersistenceFailed` → OS alarm NOT set → error surfaces to caller.
- [ ] Integration test: process kill + relaunch → `scheduleAll()` re-arms outstanding reminders (test using mock storage state).
- [ ] Integration test: unacknowledged reminder re-fires 5 times at 12-minute intervals, then `FamilyNotifier.notifyAll()` called with `missedMedication` alert.
- [ ] Unit test: `acknowledge()` before re-fire 5 → no family notification.
- [ ] Observability events: no medication names in any event. `entry_id_hash` used throughout.
- [ ] `FamilyNotifier`: partial delivery failure (one contact fails) → log failure → continue with remaining contacts.

---

### T-029: MedicationScheduler + FamilyNotifier — Android

**Effort:** M
**Risk:** HIGH
**Depends On:** T-003, T-004

**Scope:**
Same as T-028 for Android. Use `AlarmManager.setExactAndAllowWhileIdle()` with `USE_EXACT_ALARM` permission. `START_STICKY` foreground service. FCM for family notifications.

**Acceptance Criteria:**
- [ ] Same as T-028, adapted for Android.
- [ ] `START_STICKY` foreground service re-arms reminders on relaunch.
- [ ] `USE_EXACT_ALARM` permission declared in AndroidManifest.

---

### T-030: SignalProtocolClient + RelayWebSocketClient

**Effort:** L
**Risk:** HIGH
**Depends On:** T-002, T-003, T-004

**Scope:**
Integrate `libsignal` for Signal Protocol E2E encryption (iOS + Android). Implement `SignalProtocolClient` and `RelayWebSocketClient` protocols from L2 §7.1 and §7.4. Key storage in `EncryptedLocalStorage`. Certificate pinning for relay server TLS. Exponential backoff reconnection.

**Acceptance Criteria:**
- [ ] Protocol matches L2 §7.1 + §7.4 interfaces exactly.
- [ ] Integration test: `initialise()` generates identity key, signed prekey, one-time prekeys. Keys are stored in `EncryptedLocalStorage`.
- [ ] Integration test: `encrypt()` → `decrypt()` round trip produces identical plaintext.
- [ ] Security test: TLS certificate pin mismatch → connection fails immediately (no fallback to system trust store). Test using a self-signed cert different from the pinned cert.
- [ ] Security test: `decrypt()` with tampered ciphertext returns `Failure(.DecryptionFailed)` — no partial data returned.
- [ ] Integration test: prekey supply drops below 5 → `refreshPreKeys()` triggered automatically.
- [ ] Integration test: WebSocket disconnect → exponential backoff reconnects within expected timing.
- [ ] Integration test: WebSocket offline → companion-queued config delivered on reconnection.
- [ ] Identity private key never written outside `EncryptedLocalStorage` (code review enforced; test: search codebase for any plaintext key export path).

---

### T-031: ConfigPayloadDecryptor + ConfigSchemaValidator + ConfigApplicator

**Effort:** M
**Risk:** MEDIUM
**Depends On:** T-030, T-024, T-025, T-028, T-029, T-005, T-006

**Scope:**
Implement `ConfigPayloadDecryptor`, `ConfigSchemaValidator`, and `ConfigApplicator` from L2 §7.2–7.3. Atomicity: all in-memory updates before storage write; rollback on storage failure. Hot-reload all live services without app restart.

**Acceptance Criteria:**
- [ ] Protocols match L2 §7.2–7.3 interfaces exactly.
- [ ] Unit test: config version lower than current `AppConfig.config_version` → `SchemaValidationFailed`.
- [ ] Unit test: config field key not in allowlist → `SchemaValidationFailed`. Entire payload rejected.
- [ ] Unit test: config field value wrong type → `SchemaValidationFailed`. Entire payload rejected.
- [ ] Integration test: valid config → `HealthMonitorService.updateThresholds()` called → `MedicationScheduler.loadSchedule()` called → `WakeWordDetector.reloadModel()` called → `AppConfig` updated in `EncryptedLocalStorage`.
- [ ] Atomicity test: `EncryptedLocalStorage.write()` fails during `apply()` → in-memory state rolled back → live services retain original config (verified by checking service state after failure).
- [ ] Integration test: successful config apply → TTS announces "Your settings have been updated."

---

### T-032: Companion App — iOS + Android

**Effort:** L
**Risk:** MEDIUM
**Depends On:** T-030

**Scope:**
Implement companion (family/caregiver) app for iOS and Android. Modules: `CompanionAuthService` (platform biometric), `ConfigComposer`, `RemoteConfigPusher`, `MedicationScheduleEditor`, `AlertThresholdEditor`. All config pushes via Signal-encrypted relay.

**Acceptance Criteria:**
- [ ] `MedicationScheduleEditor` validates: no duplicate times, ack window > 0.
- [ ] `AlertThresholdEditor` validates minimum safety bounds (e.g. systolic ≥ 60 and ≤ 300 mmHg) before save.
- [ ] Integration test: edit a health threshold in companion app → push via relay → primary device receives and applies via `ConfigApplicator` (end-to-end with mock relay server).
- [ ] Authentication: platform biometric (Face ID / fingerprint) gates all config changes. No custom auth layer in companion app.
- [ ] "Low prekey" warning shown in companion app UI when primary device signals prekey exhaustion.
- [ ] Config payload never contains PII in any field name or value that appears in observability.

---

## 5. Risk Summary

| Risk | Tasks | Severity | Mitigation |
|------|-------|----------|------------|
| PAD/liveness detection not designed before implementation | T-014, T-015 | CRITICAL | Design note required as pre-condition (BLOCKER from security-design-review.md) |
| llama.cpp OOM on low-end Android | T-019 | HIGH | Runtime RAM check; decline load if < 2.5 GB available |
| iOS BGTaskScheduler budget exceeded | T-028 | HIGH | Local notifications as primary; BGTask supplemental |
| Signal Protocol prekey exhaustion | T-030 | HIGH | Pre-generate 100 prekeys; refresh < 5 threshold |
| openWakeWord model size in app binary | T-005, T-006 | MEDIUM | Download-on-first-launch with fallback to manual activation |
| iOS Secure Enclave key lost on restore | T-014 | MEDIUM | Detect unavailability; prompt re-enrolment; never fail silently |
| Argon2id unavailable on Android < API 29 | T-016 | MEDIUM | JNI wrapper (bouncy castle / libsodium) confirmed in implementation |
| Google Calendar OAuth revocation | T-021 (entity extraction depends on calendar data) | MEDIUM | Detect 401; prompt re-auth; disable calendar features |
| Emergency silent TTS failure | T-012, T-013, T-026, T-027 | HIGH | Platform-native TTS fallback required; blocking test |
| Safety-critical services not isolated from LLM | T-018/T-019 vs T-024–T-029 | HIGH | Build target isolation enforced; build test verifies no import |

---

## 6. CI/CD and Code Review Requirements

- All tasks require code review by at least one other developer before merge.
- Tasks T-014, T-015, T-026, T-027, T-028, T-029 (safety-critical) require review by lead engineer AND security reviewer.
- T-030 (Signal Protocol) requires review by security reviewer before merge.
- CI pipeline gates: build (zero warnings), unit tests, lint.
- Nightly: performance tests (T-009, T-010, T-018, T-019, T-022, T-023) and end-to-end integration tests (T-021).
- Platform device farm: all tasks with `Performance test` acceptance criteria must be run on physical devices (iPhone 12 for iOS, Android reference device with ≥ 4 GB RAM).
- Security review required before merging: T-014, T-015, T-016, T-020, T-030.

---

## 7. Effort Summary

| Effort | Count | Days (approx) |
|--------|-------|---------------|
| S (1–2 days) | 5 | 5–10 |
| M (3–5 days) | 19 | 57–95 |
| L (6–10 days) | 7 | 42–70 |
| XL | 0 | — |
| **Total (sequential, single dev)** | **31** | **~104–175 days** |

**With parallel iOS/Android tracks (2 developers):** ~52–88 days.
**With full parallel execution (4+ developers, all independent streams):** ~27–45 days.

---

## 8. Traceability

| Task | Requirements Covered |
|------|---------------------|
| T-002, T-003 | NFR-015, NFR-016 |
| T-004 | NFR-015, NFR-016 |
| T-005, T-006 | FR-004, NFR-006, NFR-007 |
| T-007, T-008 | FR-004, NFR-006, NFR-007 |
| T-009, T-010 | FR-001, FR-002, FR-005, NFR-001 |
| T-011 | FR-005 |
| T-012, T-013 | FR-002, FR-003, FR-006 |
| T-014, T-015 | FR-011, FR-012, FR-013, NFR-011 |
| T-016 | FR-014 |
| T-017 | FR-013, FR-014, FR-015 |
| T-018, T-019 | FR-007, FR-008, FR-009, NFR-002 |
| T-020 | NFR-013 (prompt injection) |
| T-021 | FR-008 |
| T-022, T-023 | FR-001–FR-006, NFR-001–NFR-002 |
| T-024, T-025 | FR-031, FR-032, NFR-004, NFR-026 |
| T-026, T-027 | FR-033, FR-034, FR-035, FR-036, NFR-026, NFR-028 |
| T-028, T-029 | FR-026, FR-027, FR-028, FR-029, NFR-026, NFR-027 |
| T-030 | FR-038, FR-039, NFR-012 |
| T-031 | FR-040, FR-041, FR-042 |
| T-032 | FR-038–FR-046 |
