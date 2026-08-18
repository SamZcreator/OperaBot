// server/permission-proxy.ts
import { connect } from "node:net";
import { randomUUID } from "node:crypto";
var socketPath = process.argv[2] ?? "";
var waiting = /* @__PURE__ */ new Map();
var conn = connect(socketPath);
var dead = () => {
  for (const resolve of waiting.values()) {
    resolve({ behavior: "deny", message: "OperaBot: permission broker unavailable \u2014 skip this action" });
  }
  waiting.clear();
};
conn.on("error", dead);
conn.on("close", dead);
var connBuf = "";
conn.on("data", (chunk) => {
  connBuf += chunk;
  let nl;
  while ((nl = connBuf.indexOf("\n")) !== -1) {
    const line = connBuf.slice(0, nl);
    connBuf = connBuf.slice(nl + 1);
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.t === "answer") {
      waiting.get(msg.id)?.(msg);
      waiting.delete(msg.id);
    }
  }
});
var send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
var TOOLS = [
  {
    name: "approve",
    description: "Ask the OperaBot user whether a tool use is allowed",
    inputSchema: {
      type: "object",
      properties: {
        tool_name: { type: "string" },
        input: { type: "object" },
        tool_use_id: { type: "string" }
      },
      required: ["tool_name", "input"]
    }
  },
  {
    name: "ask_user",
    description: "Ask the human who owns this bot a question and wait for their answer. Use whenever you need a decision, a preference, missing information, or sign-off before doing something consequential \u2014 do not guess on things the owner would want to decide. Returns their answer as text.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question, with enough context to answer at a glance" },
        choices: {
          type: "array",
          items: { type: "string" },
          description: "Optional 2-5 suggested answers, shown as one-tap buttons"
        }
      },
      required: ["question"]
    }
  }
];
async function handle(msg) {
  if (msg.method === "initialize") {
    return send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "operabot-permissions", version: "1" }
      }
    });
  }
  if (msg.method === "tools/list") return send({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
  if (msg.method === "tools/call") {
    const name = msg.params?.name;
    const args = msg.params?.arguments ?? {};
    const askId = randomUUID();
    const isQuestion = name === "ask_user";
    const suggestions = Array.isArray(args.permission_suggestions) ? args.permission_suggestions : Array.isArray(args.suggestions) ? args.suggestions : null;
    const answer = await new Promise((resolve) => {
      waiting.set(askId, resolve);
      if (conn.destroyed) return dead();
      const ask = isQuestion ? { t: "ask", id: askId, kind: "question", tool: "ask_user", input: { question: args.question, choices: args.choices } } : { t: "ask", id: askId, tool: args.tool_name, input: args.input };
      try {
        conn.write(JSON.stringify(ask) + "\n");
      } catch {
        dead();
      }
    });
    let text = answer.message || "No answer was given \u2014 use your best judgment.";
    if (!isQuestion) {
      if (answer.behavior === "allow") {
        const result = { behavior: "allow", updatedInput: args.input ?? {} };
        if (answer.always && suggestions) result.updatedPermissions = suggestions;
        text = JSON.stringify(result);
      } else {
        text = JSON.stringify({ behavior: "deny", message: answer.message || "Denied from OperaBot" });
      }
    }
    return send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text }] } });
  }
  if (String(msg.method ?? "").startsWith("notifications/")) return;
  if (msg.id != null) {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } });
  }
}
var inBuf = "";
process.stdin.on("data", (chunk) => {
  inBuf += chunk;
  let nl;
  while ((nl = inBuf.indexOf("\n")) !== -1) {
    const line = inBuf.slice(0, nl);
    inBuf = inBuf.slice(nl + 1);
    if (!line.trim()) continue;
    try {
      void handle(JSON.parse(line));
    } catch {
    }
  }
});
process.stdin.on("end", () => process.exit(0));
