import type { CompanionSpec, ResourceSpec, ToolSpec } from '@web-companion/spec';

export class ActionRegistry {
  private tools = new Map<string, ToolSpec>();
  private resources = new Map<string, ResourceSpec>();

  register(spec: CompanionSpec): void {
    for (const tool of spec.tools ?? []) {
      if (this.tools.has(tool.name)) {
        throw new Error(`Duplicate tool name: ${tool.name}`);
      }
      this.tools.set(tool.name, tool);
    }
    for (const resource of spec.resources ?? []) {
      if (this.resources.has(resource.name)) {
        throw new Error(`Duplicate resource name: ${resource.name}`);
      }
      this.resources.set(resource.name, resource);
    }
  }

  getTool(name: string): ToolSpec | undefined {
    return this.tools.get(name);
  }

  getResource(name: string): ResourceSpec | undefined {
    return this.resources.get(name);
  }

  listTools(): ToolSpec[] {
    return [...this.tools.values()];
  }

  listResources(): ResourceSpec[] {
    return [...this.resources.values()];
  }

  clear(): void {
    this.tools.clear();
    this.resources.clear();
  }
}
