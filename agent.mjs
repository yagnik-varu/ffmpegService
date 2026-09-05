import 'dotenv/config';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "omniroutes-agent", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// 1. Define the Read, Write, and delegation tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "omniroutes_read",
        description: "Read data from the external Omniroutes endpoint",
        inputSchema: {
          type: "object",
          properties: {
            endpointPath: {
              type: "string",
              description: "The path of the endpoint to read from (e.g., /v1/data)"
            }
          },
          required: ["endpointPath"]
        }
      },
      {
        name: "omniroutes_write",
        description: "Write data or send a payload to Omniroutes",
        inputSchema: {
          type: "object",
          properties: {
            endpointPath: {
              type: "string",
              description: "The path of the endpoint to write to (e.g., /v1/data)"
            },
            payload: {
              type: "object",
              description: "The JSON payload to send in the request body"
            }
          },
          required: ["endpointPath", "payload"]
        }
      },
      {
        name: "list_models",
        description: "List the models currently available through the Omniroutes gateway. Call this before delegate_task if you don't already know which model id to use.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "delegate_task",
        description: "Delegate a task to a non-Claude model via Omniroutes, to save Claude quota. Use this for tasks that do not require advanced reasoning, such as summarization, formatting, boilerplate generation, or simple data transforms. Call list_models first if you don't already know which model id to use.",
        inputSchema: {
          type: "object",
          properties: {
            model: {
              type: "string",
              description: "The model id to run the task on (see list_models for available ids)"
            },
            task: {
              type: "string",
              description: "The task/instruction for the model to perform"
            },
            context: {
              type: "string",
              description: "Optional supporting context/content for the task (e.g. the text to summarize)"
            }
          },
          required: ["model", "task"]
        }
      }
    ]
  };
});

// 2. Execute the call to Omniroutes when Claude asks
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const BASE_URL = process.env.OMNIROUTES_BASE_URL || "https://api.omniroutes.com";
  const API_KEY = process.env.OMNIROUTES_API_KEY || "";

  const headers = {
    "Content-Type": "application/json",
    ...(API_KEY ? { "Authorization": `Bearer ${API_KEY}` } : {})
  };

  try {
    if (request.params.name === "omniroutes_read") {
      const url = `${BASE_URL}${request.params.arguments.endpointPath}`;
      const response = await fetch(url, { headers });

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const data = await response.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
      };
    }

    if (request.params.name === "omniroutes_write") {
      const url = `${BASE_URL}${request.params.arguments.endpointPath}`;
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(request.params.arguments.payload)
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const data = await response.json();
      return {
        content: [{ type: "text", text: `Successfully wrote data:\n${JSON.stringify(data, null, 2)}` }]
      };
    }

    if (request.params.name === "list_models") {
      const url = `${BASE_URL}/v1/models`;
      const response = await fetch(url, { headers });

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const data = await response.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
      };
    }

    if (request.params.name === "delegate_task") {
      const { model, task, context } = request.params.arguments;
      const url = `${BASE_URL}/v1/chat/completions`;

      const messages = context
        ? [{ role: "user", content: `${task}\n\n${context}` }]
        : [{ role: "user", content: task }];

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, messages })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content ?? JSON.stringify(data, null, 2);

      console.error(`[delegate_task] model=${model} task="${task.slice(0, 80)}"`);

      return {
        content: [{ type: "text", text }]
      };
    }

    throw new Error("Tool not found");
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error calling Omniroutes: ${error.message}` }]
    };
  }
});

// 3. Start the server via standard input/output
const transport = new StdioServerTransport();
await server.connect(transport);
