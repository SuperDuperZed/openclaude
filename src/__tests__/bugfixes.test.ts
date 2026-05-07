/**
 * Tests for Bug Fixes applied to openclaude.
 *
 * Covers:
 * 1. Gemini `store: false` rejection fix
 * 2. Session timeout / 500 error fix (stream idle timeout)
 * 3. Agent loop continuation nudge
 * 4. Web search result count improvements
 */

import { describe, test, expect } from 'bun:test'
import { resolve } from 'path'

const SRC = resolve(import.meta.dir, '..')
const file = (relative: string) => Bun.file(resolve(SRC, relative))

// ---------------------------------------------------------------------------
// Fix 1: Gemini `store: false` rejection
// ---------------------------------------------------------------------------
describe('Gemini store field fix', () => {
  test('descriptor-backed shim config strips store for Gemini and Mistral routes', async () => {
    const runtimeMetadata = await file('integrations/runtimeMetadata.ts').text()
    const geminiDescriptor = await file('integrations/vendors/gemini.ts').text()
    const mistralDescriptor = await file('integrations/gateways/mistral.ts').text()

    expect(runtimeMetadata).toContain('removeBodyFields')
    expect(geminiDescriptor).toContain("removeBodyFields: ['store']")
    expect(mistralDescriptor).toContain("removeBodyFields: ['store']")
  })

  test('store: false is still set by default and only removed via shim config', async () => {
    const content = await file('services/api/openaiShim.ts').text()

    expect(content).toMatch(/store:\s*false/)
    expect(content).toContain('shimConfig.removeBodyFields')
    expect(content).toContain('delete body[field]')
  })

  test('openaiShim does not keep a hardcoded descriptor route fallback list', async () => {
    const content = await file('services/api/openaiShim.ts').text()

    expect(content).not.toContain(
      "['mistral', 'gemini', 'moonshot', 'deepseek', 'zai', 'kimi-code']",
    )
  })
})

// ---------------------------------------------------------------------------
// Fix 2: Session timeout — stream idle timeout
// ---------------------------------------------------------------------------
describe('Session timeout fix', () => {
  test('openaiShim has idle timeout for SSE streams', async () => {
    const content = await file('services/api/openaiShim.ts').text()

    expect(content).toContain('STREAM_IDLE_TIMEOUT_MS')
    expect(content).toContain('readWithTimeout')
    expect(content).toMatch(/readWithTimeout\(\)/)
  })

  test('codexShim has idle timeout for SSE streams', async () => {
    const content = await file('services/api/codexShim.ts').text()

    expect(content).toContain('STREAM_IDLE_TIMEOUT_MS')
    expect(content).toContain('readWithTimeout')
    expect(content).toMatch(/readWithTimeout\(\)/)
  })

  test('idle timeout is set to a reasonable value (>= 60s)', async () => {
    const content = await file('services/api/openaiShim.ts').text()

    // Extract the timeout value (supports numeric separators like 120_000)
    const match = content.match(/STREAM_IDLE_TIMEOUT_MS\s*=\s*([\d_]+)/)
    expect(match).not.toBeNull()
    const timeoutMs = parseInt(match![1].replace(/_/g, ''), 10)
    expect(timeoutMs).toBeGreaterThanOrEqual(60_000)
  })
})

// ---------------------------------------------------------------------------
// Fix 3: Agent loop continuation nudge
// ---------------------------------------------------------------------------
describe('Agent loop continuation nudge', () => {
  test('query.ts has continuation signal detection', async () => {
    const content = await file('query.ts').text()

    expect(content).toContain('continuationSignals')
    expect(content).toContain('Continuation nudge triggered')
    expect(content).toContain('continuation_nudge')
  })

  test('continuation signals include tightened patterns', async () => {
    const content = await file('query.ts').text()

    // Should detect tightened patterns requiring explicit action verbs
    expect(content).toMatch(/so now \(i\|let me\|we\)/)
    expect(content).toContain('completionMarkers')
    expect(content).toContain('MAX_CONTINUATION_NUDGES')
    // Verify the nudge counter guard exists
    expect(content).toMatch(/continuationNudgeCount\s*<\s*MAX_CONTINUATION_NUDGES/)
  })

  test('nudge creates a meta user message to continue', async () => {
    const content = await file('query.ts').text()

    expect(content).toContain(
      'Continue with the task. Use the appropriate tools to proceed.',
    )
  })
})

// ---------------------------------------------------------------------------
// Fix 4: Web search result count improvements
// ---------------------------------------------------------------------------
describe('Web search result count improvements', () => {
  test('Bing provider requests at least 15 results', async () => {
    const content = await file(
      'tools/WebSearchTool/providers/bing.ts',
    ).text()

    expect(content).toMatch(/count.*['"]15['"]/)
  })

  test('Tavily provider requests at least 15 results', async () => {
    const content = await file(
      'tools/WebSearchTool/providers/tavily.ts',
    ).text()

    expect(content).toMatch(/max_results:\s*15/)
  })

  test('Exa provider requests at least 15 results', async () => {
    const content = await file(
      'tools/WebSearchTool/providers/exa.ts',
    ).text()

    expect(content).toMatch(/numResults:\s*15/)
  })

  test('Firecrawl provider requests at least 15 results', async () => {
    const content = await file(
      'tools/WebSearchTool/providers/firecrawl.ts',
    ).text()

    expect(content).toMatch(/limit:\s*15/)
  })

  test('Mojeek provider requests at least 10 results', async () => {
    const content = await file(
      'tools/WebSearchTool/providers/mojeek.ts',
    ).text()

    // Mojeek uses 't' param for result count — verify it's set to 10
    expect(content).toMatch(/searchParams\.set\('t',\s*'10'\)/)
  })

  test('You.com provider requests at least 10 results', async () => {
    const content = await file(
      'tools/WebSearchTool/providers/you.ts',
    ).text()

    expect(content).toMatch(/num_web_results.*['"]10['"]/)
  })

  test('Jina provider requests at least 10 results', async () => {
    const content = await file(
      'tools/WebSearchTool/providers/jina.ts',
    ).text()

    expect(content).toMatch(/count.*['"]10['"]/)
  })

  test('Native Anthropic web search max_uses increased to 15', async () => {
    const content = await file(
      'tools/WebSearchTool/WebSearchTool.ts',
    ).text()

    expect(content).toMatch(/max_uses:\s*15/)
  })

  test('codex web search path guarantees a non-empty result body', async () => {
    const content = await file(
      'tools/WebSearchTool/WebSearchTool.ts',
    ).text()

    expect(content).toContain("results.push('No results found.')")
  })
})

// ---------------------------------------------------------------------------
// Fix 5: MCP tool timeout fix
// ---------------------------------------------------------------------------
describe('MCP tool timeout fix', () => {
  test('default MCP tool timeout is reasonable (not 27 hours)', async () => {
    const content = await file('services/mcp/client.ts').text()

    // Should NOT have the old ~27.8 hour default
    expect(content).not.toContain('100_000_000')
    // Should have a reasonable timeout (5 minutes = 300_000ms)
    expect(content).toMatch(/DEFAULT_MCP_TOOL_TIMEOUT_MS\s*=\s*300_000/)
  })

  test('MCP tools/list has retry logic', async () => {
    const content = await file('services/mcp/client.ts').text()

    expect(content).toContain('tools/list failed (attempt')
    expect(content).toContain('Retrying...')
  })

  test('MCP URL elicitation checks abort signal', async () => {
    const content = await file('services/mcp/client.ts').text()

    expect(content).toContain('signal.aborted')
    expect(content).toContain('Tool call aborted during URL elicitation')
  })

  test('MCP tool error messages include server and tool name in telemetry', async () => {
    const content = await file('services/mcp/client.ts').text()

    // Telemetry message should include context like "MCP tool [serverName] toolName: error"
    // The human-readable message stays unchanged to avoid breaking error consumers
    expect(content).toContain('MCP tool [${name}] ${tool}:')
  })
})

// ---------------------------------------------------------------------------
// Cross-cutting: verify no regressions
// ---------------------------------------------------------------------------
describe('Regression checks', () => {
  test('store field remains opt-out by per-route config rather than unconditional deletion', async () => {
    const openaiShim = await file('services/api/openaiShim.ts').text()
    const runtimeMetadata = await file('integrations/runtimeMetadata.ts').text()

    expect(openaiShim).toMatch(/store:\s*false/)
    expect(openaiShim).toContain('for (const field of shimConfig.removeBodyFields ?? [])')
    expect(runtimeMetadata).toContain('mergeRemoveBodyFields')
  })
})

// ---------------------------------------------------------------------------
// Fix 6: SendMessageTool race condition guard
// ---------------------------------------------------------------------------
describe('SendMessageTool race condition fix', () => {
  test('SendMessageTool has double-check for concurrent resume', async () => {
    const content = await file('tools/SendMessageTool/SendMessageTool.ts').text()

    // Should have a second status check before resuming to prevent race
    expect(content).toContain('was concurrently resumed')
    // The freshTask check should re-read from getAppState
    expect(content).toMatch(/const freshTask = context\.getAppState\(\)\.tasks\[agentId\]/)
  })
})

// ---------------------------------------------------------------------------
// Fix 7: AgentTool dump state cleanup
// ---------------------------------------------------------------------------
describe('AgentTool cleanup fix', () => {
  test('backgrounded agent always cleans up dump state', async () => {
    const content = await file('tools/AgentTool/AgentTool.tsx').text()

    // The backgrounded agent's finally block should clean up regardless
    // of whether the agent crashed or completed normally
    expect(content).toContain('Defensive cleanup: wrap each call so one failure')
    // Verify cleanup is wrapped in try/catch for defensive execution
    expect(content).toMatch(/try\s*\{\s*clearInvokedSkillsForAgent/)
    expect(content).toMatch(/try\s*\{\s*clearDumpState/)
  })
})

// ---------------------------------------------------------------------------
// Fix 8: Context overflow 500 error handling
// ---------------------------------------------------------------------------
describe('Context overflow 500 fix', () => {
  test('errors.ts has handler for context overflow 500 errors', async () => {
    const content = await file('services/api/errors.ts').text()

    expect(content).toContain('500 errors caused by context overflow')
    expect(content).toContain('too many tokens')
    expect(content).toContain('The conversation has grown too large')
  })

  test('query.ts has circuit breaker safety net for oversized context', async () => {
    const content = await file('query.ts').text()

    expect(content).toContain('Safety net: when auto-compact')
    expect(content).toContain('circuit breaker has tripped')
    expect(content).toContain('automatic compaction has failed')
  })
})

// ---------------------------------------------------------------------------
// Fix N: Project-scope MCP servers from .mcp.json not detected for 3P providers (issue #696)
// ---------------------------------------------------------------------------
describe('Project-scope MCP approval — third-party providers (issue #696)', () => {
  test('handleMcpjsonServerApprovals is NOT gated behind usesAnthropicSetup', async () => {
    const content = await file('interactiveHelpers.tsx').text()

    // The call site for handleMcpjsonServerApprovals must not sit inside an
    // `if (usesAnthropicSetup) { ... }` block, or third-party providers will
    // never get the dialog and project-scope .mcp.json servers will be silently
    // dropped from /mcp listings (issue #696).
    const approvalCallIdx = content.indexOf('await handleMcpjsonServerApprovals(root)')
    expect(approvalCallIdx).toBeGreaterThan(-1)

    // Look at the 800 chars BEFORE the call site for any `if (usesAnthropicSetup)`
    // block that would still be open. Pick a window that's definitely inside the
    // showSetupScreens function but not in earlier dialogs.
    const before = content.slice(Math.max(0, approvalCallIdx - 800), approvalCallIdx)
    expect(before).not.toMatch(/if\s*\(\s*usesAnthropicSetup\s*\)\s*{[^}]*$/)
  })

  test('issue #696 is referenced from the comment so future readers can find context', async () => {
    const content = await file('interactiveHelpers.tsx').text()
    expect(content).toContain('#696')
  })
})

// ---------------------------------------------------------------------------
// Fix: useDeferredHookMessages double-injection race condition
// ---------------------------------------------------------------------------
describe('useDeferredHookMessages race condition fix', () => {
  test('uses resolvePromiseRef instead of boolean resolvedRef to prevent double injection', async () => {
    const content = await file('hooks/useDeferredHookMessages.ts').text()

    // Should NOT use the old boolean flag pattern
    expect(content).not.toContain('resolvedRef')
    // Should use the new promise-based single-resolution mechanism
    expect(content).toContain('resolvePromiseRef')
    expect(content).toContain('Promise<void> | null')
  })

  test('the callback awaits the effect resolution instead of re-injecting messages', async () => {
    const content = await file('hooks/useDeferredHookMessages.ts').text()

    const callbackStart = content.indexOf('return useCallback(async () =>')
    expect(callbackStart).toBeGreaterThan(-1)
    const callbackBlock = content.slice(callbackStart, callbackStart + 600)
    expect(callbackBlock).toContain('await resolvePromiseRef.current')
    expect(callbackBlock).not.toContain('setMessages')
    expect(callbackBlock).not.toContain('injectMessages')
  })

  test('only one injection site exists — the useEffect .then() handler', async () => {
    const content = await file('hooks/useDeferredHookMessages.ts').text()
    const matches = content.match(/injectMessages\(/g)
    expect(matches).toHaveLength(1)
  })

  test('the hook documents the single-resolution mechanism in its JSDoc', async () => {
    const content = await file('hooks/useDeferredHookMessages.ts').text()
    expect(content).toContain('single resolution mechanism')
    expect(content).toContain('double-injection race')
  })
})

// ---------------------------------------------------------------------------
// Fix: Bridge pointer race condition (pointerGeneration snapshot)
// ---------------------------------------------------------------------------
describe('Bridge pointer race condition fix', () => {
  test('pointerGeneration counter is declared before the refresh timer', async () => {
    const content = await file('bridge/replBridge.ts').text()
    expect(content).toContain('let pointerGeneration = 0')
    const declIdx = content.indexOf('let pointerGeneration = 0')
    const timerIdx = content.indexOf('pointerRefreshTimer')
    expect(declIdx).toBeGreaterThan(-1)
    expect(timerIdx).toBeGreaterThan(-1)
    expect(declIdx).toBeLessThan(timerIdx)
  })

  test('doReconnect bumps pointerGeneration at the start', async () => {
    const content = await file('bridge/replBridge.ts').text()
    const reconnectStart = content.indexOf('async function doReconnect()')
    expect(reconnectStart).toBeGreaterThan(-1)
    const reconnectBlock = content.slice(reconnectStart, reconnectStart + 600)
    expect(reconnectBlock).toContain('pointerGeneration++')
  })

  test('the hourly refresh timer snapshots generation and checks for stale reads', async () => {
    const content = await file('bridge/replBridge.ts').text()
    expect(content).toContain('const gen = pointerGeneration')
    expect(content).toContain('const snapshotSessionId = currentSessionId')
    expect(content).toContain('const snapshotEnvId = environmentId')
    expect(content).toContain('if (gen !== pointerGeneration) return')
    expect(content).toContain('sessionId: snapshotSessionId')
    expect(content).toContain('environmentId: snapshotEnvId')
  })

  test('the timer still short-circuits on reconnectPromise', async () => {
    const content = await file('bridge/replBridge.ts').text()
    expect(content).toContain('if (reconnectPromise) return')
  })
})

// ---------------------------------------------------------------------------
// Fix: ExitPlanModeV2Tool swallowed file write error
// ---------------------------------------------------------------------------
describe('ExitPlanModeV2Tool swallowed error fix', () => {
  test('plan file write uses try/catch with re-throw instead of .catch(logError)', async () => {
    const content = await file('tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts').text()
    expect(content).not.toMatch(/await writeFile\([^)]+\)\.catch\([^)]*\)/)
    expect(content).toContain('Failed to write plan file at')
    expect(content).toContain('The plan may not have been saved to disk')
  })

  test('the error message includes the file path for debugging', async () => {
    const content = await file('tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts').text()
    expect(content).toMatch(/Failed to write plan file at \$\{filePath\}/)
  })

  test('logError is still called so the error appears in telemetry', async () => {
    const content = await file('tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts').text()
    const tryStart = content.indexOf('try {')
    const catchBlock = content.indexOf('} catch (e) {', tryStart)
    expect(catchBlock).toBeGreaterThan(-1)
    const catchSection = content.slice(catchBlock, catchBlock + 500)
    expect(catchSection).toContain('logError(e)')
    expect(catchSection).toContain('throw new Error')
  })
})

// ---------------------------------------------------------------------------
// Fix: Unbounded speculativeChecks Map (LRU eviction)
// ---------------------------------------------------------------------------
describe('Speculative checks Map LRU eviction fix', () => {
  test('SPECULATIVE_CHECKS_MAX_SIZE constant is defined', async () => {
    const content = await file('tools/BashTool/bashPermissions.ts').text()
    expect(content).toContain('SPECULATIVE_CHECKS_MAX_SIZE')
    expect(content).toMatch(/SPECULATIVE_CHECKS_MAX_SIZE\s*=\s*500/)
  })

  test('evictStaleSpeculativeChecks function exists and uses FIFO eviction', async () => {
    const content = await file('tools/BashTool/bashPermissions.ts').text()
    expect(content).toContain('function evictStaleSpeculativeChecks()')
    expect(content).toContain('for (const key of speculativeChecks.keys())')
    expect(content).toContain('speculativeChecks.delete(key)')
    expect(content).toContain('entriesToRemove')
    expect(content).toContain('if (speculativeChecks.size <= SPECULATIVE_CHECKS_MAX_SIZE) return')
  })

  test('startSpeculativeClassifierCheck calls eviction after inserting', async () => {
    const content = await file('tools/BashTool/bashPermissions.ts').text()
    const setIdx = content.indexOf("speculativeChecks.set(command, promise)")
    expect(setIdx).toBeGreaterThan(-1)
    const afterSet = content.slice(setIdx, setIdx + 100)
    expect(afterSet).toContain('evictStaleSpeculativeChecks()')
  })

  test('clearSpeculativeChecks resets the map completely', async () => {
    const content = await file('tools/BashTool/bashPermissions.ts').text()
    expect(content).toContain('speculativeChecks.clear()')
  })

  test('the eviction is documented with JSDoc explaining the FIFO strategy', async () => {
    const content = await file('tools/BashTool/bashPermissions.ts').text()
    expect(content).toContain('Evict the oldest entries')
    expect(content).toContain('FIFO ordering')
  })
})

// ---------------------------------------------------------------------------
// Fix: .at(-1)! null assertion on potentially empty arrays
// ---------------------------------------------------------------------------
describe('SessionStorage .at(-1) null safety fix', () => {
  test('convertToLogOption throws on empty transcript instead of crashing with undefined', async () => {
    const content = await file('utils/sessionStorage.ts').text()
    expect(content).toContain('Cannot convert empty transcript to LogOption')
    const funcStart = content.indexOf('function convertToLogOption(')
    const atCall = content.indexOf('.at(-1)', funcStart)
    expect(atCall).toBeGreaterThan(funcStart)
    const guardBlock = content.slice(funcStart, atCall)
    expect(guardBlock).toContain("if (transcript.length === 0)")
    expect(guardBlock).toContain('throw new Error')
  })

  test('pickDepthOneUuidCandidate uses null coalescing fallback instead of non-null assertion', async () => {
    const content = await file('utils/sessionStorage.ts').text()
    const funcStart = content.indexOf('function pickDepthOneUuidCandidate(')
    expect(funcStart).toBeGreaterThan(-1)
    const funcEnd = content.indexOf('\n}', funcStart)
    const funcBody = content.slice(funcStart, funcEnd + 2)
    expect(funcBody).toContain('.at(-1) ?? -1')
    expect(funcBody).not.toContain('candidates.at(-1)!')
  })
})

// ---------------------------------------------------------------------------
// Fix: Recursive debounce infinite loop in TeamMemoryWatcher
// ---------------------------------------------------------------------------
describe('TeamMemoryWatcher recursive debounce fix', () => {
  test('MAX_RESCHEDULE_ATTEMPTS is defined and set to a reasonable limit', async () => {
    const content = await file('services/teamMemorySync/watcher.ts').text()
    expect(content).toContain('MAX_RESCHEDULE_ATTEMPTS')
    expect(content).toMatch(/MAX_RESCHEDULE_ATTEMPTS\s*=\s*5/)
  })

  test('rescheduleCount is tracked and checked in the debounce timer', async () => {
    const content = await file('services/teamMemorySync/watcher.ts').text()
    expect(content).toContain('let rescheduleCount = 0')
    expect(content).toContain('rescheduleCount++')
    expect(content).toMatch(/rescheduleCount\s*>\s*MAX_RESCHEDULE_ATTEMPTS/)
  })

  test('the debounce timer breaks the loop when reschedule limit is reached', async () => {
    const content = await file('services/teamMemorySync/watcher.ts').text()
    expect(content).toContain('push reschedule limit reached')
    const limitCheck = content.indexOf('rescheduleCount > MAX_RESCHEDULE_ATTEMPTS')
    expect(limitCheck).toBeGreaterThan(-1)
    const afterLimit = content.slice(limitCheck, limitCheck + 300)
    expect(afterLimit).toContain('rescheduleCount = 0')
    expect(afterLimit).toContain('return')
  })

  test('rescheduleCount is reset on successful push execution', async () => {
    const content = await file('services/teamMemorySync/watcher.ts').text()
    const scheduleStart = content.indexOf('function schedulePush()')
    const scheduleEnd = content.indexOf('}, DEBOUNCE_MS)', scheduleStart)
    const scheduleBody = content.slice(scheduleStart, scheduleEnd + 20)
    expect(scheduleBody).toContain('rescheduleCount = 0')
  })

  test('the limit reached message includes the count for debugging', async () => {
    const content = await file('services/teamMemorySync/watcher.ts').text()
    expect(content).toMatch(/reschedule limit reached \(\$?\{?rescheduleCount\}?/)
  })
})
