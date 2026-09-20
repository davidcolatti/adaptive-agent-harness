import type { ExecutionContext, JevNode, JsonValue, NodeId, RunId } from "@internal/core";
import { newNodeExecutionId } from "@internal/core";

/**
 * The three ports the local workflow runtime (M4-T6) needs and does not own.
 *
 * Each one exists because the thing behind it belongs to a milestone that has
 * not happened yet, and inventing an implementation here would be building the
 * wrong thing early:
 *
 * - {@link WorkflowDecisionPort} is M3's `DecisionEngine` seen from M4. A `jev`
 *   node names a question, and M3 owns questions, the engine and the answer
 *   shape. M4 needs exactly one verb — "answer this node's question" — so that
 *   is all this port has, and M4's own tests supply a fake.
 * - {@link ArtifactStorePort} is M5's artifact store seen from M4. Where an
 *   artifact actually lives is M5's decision (`docs/contracts/workflow-ir.md`
 *   says so explicitly: nothing about a path, a bucket or a key belongs in the
 *   IR), so the runtime writes through a port and defaults to memory.
 * - {@link ProtectedEffectStore} is what makes M4-T7's protection mean
 *   anything. It is deliberately **not durable**: M4-T6 says "do not build
 *   durability yet", so the default lives for one process and the interface is
 *   what a durable implementation will satisfy later.
 *
 * All three are plain interfaces rather than classes, so a test double is an
 * object literal and no test needs a framework to build one.
 */

/** What {@link WorkflowDecisionPort.decide} is asked. */
export interface WorkflowDecisionRequest {
  /** The `jev` node being executed, including its question reference and kind. */
  readonly node: JevNode;
  /** The node's validated input, as JSON. */
  readonly input: JsonValue;
  /** The run's execution context, so an engine can trace and honour cancellation. */
  readonly context: ExecutionContext;
}

/**
 * Whatever can answer a `jev` node's question.
 *
 * M3 implements this over Jev. The return value is a bare {@link JsonValue}
 * rather than a richer result type on purpose: M4 cannot define M3's answer
 * shape without guessing it, and a node's own `outputSchema` is what decides
 * whether the answer is usable. When M3 lands, this port is what its engine is
 * adapted to, and nothing in the interpreter changes.
 */
export interface WorkflowDecisionPort {
  /** Answer one `jev` node's question. */
  decide(request: WorkflowDecisionRequest): Promise<JsonValue>;
}

/** What an `artifact` node asks the store to keep. */
export interface ArtifactSaveInput {
  /** The run the artifact belongs to. */
  readonly runId: RunId;
  /** The node that produced it. */
  readonly nodeId: NodeId;
  /** The artifact's role within the workflow, from `ArtifactNode.name`. */
  readonly name: string;
  /** The media type, when the node declares one. */
  readonly contentType?: string;
  /** The value being stored: the node's validated input. */
  readonly value: JsonValue;
}

/** What a store returns once it has kept an artifact. */
export interface SavedArtifact {
  /**
   * The stored artifact's identifier.
   *
   * A plain string, not a branded entity id: ADR-0030 defines twelve brands and
   * an artifact is not one of them, and minting a thirteenth here would be M5's
   * decision made by M4. The default store below mints a sortable UUIDv7 so the
   * value is still ordered and unique; a real store returns its own key.
   */
  readonly artifactId: string;
}

/** Where an `artifact` node's output goes. */
export interface ArtifactStorePort {
  /** Store one value and return the reference the node outputs. */
  save(input: ArtifactSaveInput): Promise<SavedArtifact>;
}

/** One artifact the in-memory store is holding. */
export interface InMemoryArtifact extends ArtifactSaveInput {
  /** The id the store minted for it. */
  readonly artifactId: string;
}

/** An {@link ArtifactStorePort} that keeps everything in this process. */
export interface InMemoryArtifactStore extends ArtifactStorePort {
  /** Everything saved so far, in save order. */
  readonly saved: readonly InMemoryArtifact[];
}

/**
 * The default {@link ArtifactStorePort}: a list in memory.
 *
 * It is the honest default for M4, which explicitly does not build durability.
 * The id is minted with `newNodeExecutionId()` — a sortable UUIDv7 whose brand
 * is discarded, because in M4 an artifact is produced by exactly one node
 * execution and no artifact brand exists. Only the string value is used.
 */
export function createInMemoryArtifactStore(): InMemoryArtifactStore {
  const saved: InMemoryArtifact[] = [];

  return {
    saved,
    save(input: ArtifactSaveInput): Promise<SavedArtifact> {
      const artifactId: string = newNodeExecutionId();

      saved.push({ ...input, artifactId });

      return Promise.resolve({ artifactId });
    },
  };
}

/** One recorded side effect, keyed by its protection key. */
export interface ProtectedEffectRecord {
  /**
   * What the protected call returned.
   *
   * `unknown` rather than {@link JsonValue}, because this store records that a
   * side effect *happened* and hands back exactly what the tool produced. The
   * node's own `outputSchema` is what decides whether that value is acceptable,
   * and it runs on the replayed value exactly as it ran on the original. A
   * durable implementation will additionally need the value to be JSON; the
   * in-memory default does not, and pretending otherwise would be a cast rather
   * than a check.
   */
  readonly value: unknown;
}

/**
 * Where a protected non-idempotent write records that it already happened
 * (M4-T7).
 *
 * The key is the **logical** idempotency key, which is the per-attempt key with
 * the attempt removed; see `idempotency.ts` for why the runtime derives two.
 */
export interface ProtectedEffectStore {
  /** The effect recorded under `key`, or `undefined` if there is none. */
  get(key: string): Promise<ProtectedEffectRecord | undefined>;
  /** Record that the effect under `key` has happened, with its result. */
  set(key: string, record: ProtectedEffectRecord): Promise<void>;
}

/** A {@link ProtectedEffectStore} that also reports what it holds. */
export interface InMemoryProtectedEffectStore extends ProtectedEffectStore {
  /** Every key recorded so far, in first-write order. */
  keys(): readonly string[];
}

/**
 * The default {@link ProtectedEffectStore}: a map in memory.
 *
 * It survives retries within one run, which is exactly what M4-T7's acceptance
 * criterion ("a retry does not duplicate a protected side effect in tests")
 * asks for, and nothing more. It does not survive the process, because M4-T6
 * says not to build durability yet.
 */
export function createInMemoryProtectedEffectStore(): InMemoryProtectedEffectStore {
  const records = new Map<string, ProtectedEffectRecord>();

  return {
    get(key: string): Promise<ProtectedEffectRecord | undefined> {
      return Promise.resolve(records.get(key));
    },
    set(key: string, record: ProtectedEffectRecord): Promise<void> {
      records.set(key, record);

      return Promise.resolve();
    },
    keys(): readonly string[] {
      return [...records.keys()];
    },
  };
}
