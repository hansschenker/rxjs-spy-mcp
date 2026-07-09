import { registry, isSpyEnabled } from './registry';

interface DevToolsTool<Input = unknown> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Input): Promise<unknown> | unknown;
}

interface DevToolsToolGroup {
  name: string;
  description: string;
  tools: DevToolsTool[];
}

interface DevToolsToolDiscoveryEvent extends Event {
  respondWith(toolGroup: DevToolsToolGroup | Promise<DevToolsToolGroup>): void;
}

let bridgeRegistered = false;

export function registerRxjsSpyMcpDevToolsBridge(): void {
  if (!isSpyEnabled()) return;
  if (bridgeRegistered) return;
  if (typeof window === 'undefined') return;

  window.addEventListener('devtoolstooldiscovery', event => {
    const discoveryEvent = event as DevToolsToolDiscoveryEvent;

    discoveryEvent.respondWith({
      name: 'rxjs-spy-mcp',
      description:
        'Inspect tagged RxJS stream notifications, subscriptions, and MVU state transitions.',
      tools: [
        {
          name: 'rxjs_list_streams',
          description: 'List all RxJS streams currently tracked by rxjs-spy-mcp.',
          inputSchema: {
            type: 'object',
            properties: {}
          },
          execute: async () => registry.listStreams()
        },
        {
          name: 'rxjs_inspect_stream',
          description: 'Inspect one tracked RxJS stream by tag.',
          inputSchema: {
            type: 'object',
            properties: {
              tag: {
                type: 'string',
                description: 'The RxJS stream tag to inspect.'
              }
            },
            required: ['tag']
          },
          execute: async (input: { tag: string }) => registry.inspectStream(input.tag)
        },
        {
          name: 'rxjs_get_timeline',
          description: 'Return recent debug frames for one tracked RxJS stream.',
          inputSchema: {
            type: 'object',
            properties: {
              tag: {
                type: 'string',
                description: 'The RxJS stream tag to inspect.'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of frames to return.'
              }
            },
            required: ['tag']
          },
          execute: async (input: { tag: string; limit?: number }) =>
            registry.getTimeline(input.tag, input.limit ?? 25)
        }
      ]
    });
  });

  bridgeRegistered = true;
}
