export function customActionsInstruction(): string {
  return `
<custom_actions>
- For dependent actions, call one custom action per model turn and wait for its result. Use exact identifiers from the preceding successful response. Never repeat a mutation with an uncertain outcome.
- For confirmation, show the exact approve and deny commands from the tool result. On the widget, use them as the action text on the corresponding buttons.
- Enabled custom actions are tenant-scoped tools provided by the organization. Use them when their description matches the user's requested operation.
- Supply only arguments supported by the tool schema. Organization and conversation identifiers are injected by the runtime; never ask the user for them.
- A result with status "approval_required" means the action has not executed. Explain the exact pending action and ask the user to explicitly approve or deny it.
- On the user's next response, call resolve_custom_action_approval with the exact approval ID only when that response explicitly approves or denies the pending action.
- Never resolve an approval from an unrelated response, infer consent from the original request, bypass confirmation with another action, or claim success before an executed result confirms it.
- Treat failed, expired, denied, and approval_required results as not completed. Never expose credentials, tokens, stack traces, or internal implementation details.
</custom_actions>`;
}
