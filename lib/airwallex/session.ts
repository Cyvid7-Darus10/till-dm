import { randomUUID } from 'node:crypto';
import { createMCPClient } from '@ai-sdk/mcp';
import { getConnectorMetadata, getTokenResponse, UserAuthorizationRequiredError } from '@vercel/connect';
import { connectAuthProvider } from '@vercel/connect/ai-sdk';
import type { ToolSet } from 'ai';
import { config } from '../config';
import { type Access, allowedTools } from './tool-policy';

type Login = { type: 'user'; id: string };

export interface AirwallexSession {
  /** Tools for this login, already narrowed by the tool policy. */
  tools: ToolSet;
  /** Calls one tool directly (not through the model) and returns its parsed JSON result. */
  call: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
}

// Looked up once per instance.
let serverUrl: string | undefined;

async function resolveServerUrl(): Promise<string> {
  if (serverUrl) return serverUrl;
  const meta = await getConnectorMetadata(config.airwallexConnector);
  const vendorUrl = meta.vendor?.serverUrl;
  const url = meta.clientUrl ?? (typeof vendorUrl === 'string' ? vendorUrl : undefined);
  if (!url) throw new Error(`connector ${config.airwallexConnector} has no server url`);
  serverUrl = url;
  return url;
}

/** True when this login has already granted Airwallex access for exactly these scopes. */
export async function isConnected(login: Login, scopes: readonly string[]): Promise<boolean> {
  try {
    await getTokenResponse(config.airwallexConnector, { subject: login, scopes: [...scopes] });
    return true;
  } catch (error: unknown) {
    if (error instanceof UserAuthorizationRequiredError) return false;
    throw new Error(`failed to check Airwallex login ${login.id}`, { cause: error });
  }
}

/** Airwallex wraps raw API JSON in <api_response_…> tags inside a text part. */
const API_RESPONSE = /<api_response_[a-f0-9]+>\s*([\s\S]*?)\s*<\/api_response_[a-f0-9]+>/;

interface ToolResult {
  isError?: boolean;
  content?: { type: string; text?: string }[];
}

/** Extracts the JSON payload from an Airwallex MCP tool result. Throws if the call failed. */
export function parseApiResponse(toolName: string, result: unknown): unknown {
  const { isError, content = [] } = (result ?? {}) as ToolResult;
  const text = content.map((part) => part.text ?? '').join('\n');
  const match = text.match(API_RESPONSE);
  // The response text can hold customer data, so it stays out of the error (and the logs).
  if (isError || !match) throw new Error(`Airwallex ${toolName} failed${isError ? '' : ': no api response in the result'}`);
  return JSON.parse(match[1]);
}

/** Opens the Airwallex MCP server as a login, with tools narrowed to what `access` allows. */
export async function openAirwallex(login: Login, scopes: readonly string[], access: Access): Promise<AirwallexSession> {
  const client = await createMCPClient({
    transport: {
      type: 'http',
      url: await resolveServerUrl(),
      authProvider: connectAuthProvider(config.airwallexConnector, { subject: login, scopes: [...scopes] }, { consent: 'eager' }),
    },
  });
  const listed = await client.listTools();
  const tools = client.toolsFromDefinitions({ ...listed, tools: allowedTools(listed.tools, access) });
  const call = async (toolName: string, args: Record<string, unknown>): Promise<unknown> => {
    const tool = tools[toolName];
    if (!tool?.execute) throw new Error(`Airwallex tool ${toolName} is not available to this login`);
    // Called by code, not inside a model step, so the step context is a placeholder.
    const result = await tool.execute(args, { toolCallId: randomUUID(), messages: [] });
    return parseApiResponse(toolName, result);
  };
  return { tools, call, close: () => client.close() };
}
