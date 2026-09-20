// The typed workflow DSL (M4-T5): `workflow()` and the authoring types it takes.
//
// Re-exported by name rather than starred, so a symbol becomes public
// deliberately. The implementation lives in `builder.ts` and the authoring
// surface in `types.ts`; the split keeps the option types readable on their own,
// because they are what an author reads.

export { workflow } from "./builder.js";
export {
  type AgentNodeOptions,
  type ArtifactNodeOptions,
  type BranchNodeOptions,
  type BranchSelectorInput,
  type CallNodeOptions,
  type ChainNodeOptions,
  type CodeNodeOptions,
  type CommonNodeOptions,
  DSL_NODE_DEFAULTS,
  DSL_WORKFLOW_VERSION_DEFAULT,
  type EscalateNodeOptions,
  type GrantingNodeOptions,
  type JevNodeOptions,
  type LoopConditionInput,
  type LoopNodeOptions,
  type MapNodeOptions,
  type NodeDefaults,
  type ReduceNodeOptions,
  type RefInput,
  type SubGraph,
  type SubGraphBuilder,
  type SubGraphEnd,
  type TypedBinding,
  type WorkflowBuilder,
  type WorkflowOptions,
} from "./types.js";
