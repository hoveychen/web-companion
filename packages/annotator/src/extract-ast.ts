import { readFile } from 'node:fs/promises';
import ts from 'typescript';

export interface InteractiveElement {
  /** Bucketed tag class. 'other' covers non-standard interactive elements like a clickable <div>. */
  kind: 'button' | 'input' | 'select' | 'textarea' | 'a' | 'other';
  /** Authored tag name (e.g. 'button' or 'MyCustomButton'). */
  tagName: string;
  /** 1-indexed line of the opening tag. */
  line: number;
  /** 1-indexed column. */
  column: number;
  /** Raw attribute values as authored. Expression initializers are rendered as `{...}`. */
  attributes: Record<string, string>;
  /** Best-effort literal text content (null if dynamic / fragment / mixed children). */
  textContent: string | null;
  /** Names of event-handler attributes (`onClick`, `onChange`, ...). */
  eventHandlers: string[];
}

export interface ListRendering {
  /** 1-indexed line of the `.map(...)` call expression. */
  line: number;
  /** 1-indexed column. */
  column: number;
  /** Source text of the iterable (e.g. `MENU`, `items`, `cartStore.getItems()`). */
  source: string;
  /** Tag name of the JSX element each iteration produces, if statically resolvable. */
  itemElementTag: string | null;
  /** Attributes on that item element. */
  itemAttributes: Record<string, string>;
}

export interface SourceSummary {
  filePath: string;
  byteSize: number;
  /** Plain text of the file — included so the LLM can also read the raw source. */
  source: string;
  interactiveElements: InteractiveElement[];
  listRenderings: ListRendering[];
}

const NATIVE_INTERACTIVE = new Set([
  'button',
  'input',
  'select',
  'textarea',
  'a',
]);

export async function extractSourceSummary(
  filePath: string,
): Promise<SourceSummary> {
  const source = await readFile(filePath, 'utf8');
  return summarizeSource(filePath, source);
}

export function summarizeSource(filePath: string, source: string): SourceSummary {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.ESNext,
    /*setParentNodes*/ true,
    ts.ScriptKind.TSX,
  );

  const interactiveElements: InteractiveElement[] = [];
  const listRenderings: ListRendering[] = [];

  function visit(node: ts.Node): void {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tagName = opening.tagName.getText(sourceFile);
      const handlers = collectHandlers(opening.attributes, sourceFile);
      const isInteractive =
        NATIVE_INTERACTIVE.has(tagName.toLowerCase()) || handlers.length > 0;

      if (isInteractive) {
        const start = node.getStart(sourceFile);
        const { line, character } =
          sourceFile.getLineAndCharacterOfPosition(start);
        interactiveElements.push({
          kind: classifyTag(tagName),
          tagName,
          line: line + 1,
          column: character + 1,
          attributes: collectAttrs(opening.attributes, sourceFile),
          textContent: ts.isJsxElement(node) ? extractLiteralText(node) : null,
          eventHandlers: handlers,
        });
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'map'
    ) {
      const [callback] = node.arguments;
      if (
        callback &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
      ) {
        const jsx = findJsxInBody(callback.body);
        if (jsx) {
          const start = node.getStart(sourceFile);
          const { line, character } =
            sourceFile.getLineAndCharacterOfPosition(start);
          const opening = ts.isJsxElement(jsx) ? jsx.openingElement : jsx;
          listRenderings.push({
            line: line + 1,
            column: character + 1,
            source: node.expression.expression.getText(sourceFile),
            itemElementTag: opening.tagName.getText(sourceFile),
            itemAttributes: collectAttrs(opening.attributes, sourceFile),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return {
    filePath,
    byteSize: source.length,
    source,
    interactiveElements,
    listRenderings,
  };
}

function collectAttrs(
  attributes: ts.JsxAttributes,
  sourceFile: ts.SourceFile,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attr of attributes.properties) {
    if (!ts.isJsxAttribute(attr)) continue;
    const name = attr.name.getText(sourceFile);
    if (!attr.initializer) {
      out[name] = 'true';
      continue;
    }
    if (ts.isStringLiteral(attr.initializer)) {
      out[name] = attr.initializer.text;
    } else if (ts.isJsxExpression(attr.initializer)) {
      const expr = attr.initializer.expression;
      if (!expr) {
        out[name] = '{}';
      } else if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
        out[name] = expr.text;
      } else {
        out[name] = `{${expr.getText(sourceFile)}}`;
      }
    }
  }
  return out;
}

function collectHandlers(
  attributes: ts.JsxAttributes,
  sourceFile: ts.SourceFile,
): string[] {
  const handlers: string[] = [];
  for (const attr of attributes.properties) {
    if (!ts.isJsxAttribute(attr)) continue;
    const name = attr.name.getText(sourceFile);
    if (/^on[A-Z]/.test(name)) handlers.push(name);
  }
  return handlers;
}

function classifyTag(tag: string): InteractiveElement['kind'] {
  const lower = tag.toLowerCase();
  if (lower === 'button') return 'button';
  if (lower === 'input') return 'input';
  if (lower === 'select') return 'select';
  if (lower === 'textarea') return 'textarea';
  if (lower === 'a') return 'a';
  return 'other';
}

function extractLiteralText(element: ts.JsxElement): string | null {
  const parts: string[] = [];
  for (const child of element.children) {
    if (ts.isJsxText(child)) {
      const t = child.text.trim();
      if (t) parts.push(t);
    }
  }
  if (parts.length === 0) return null;
  return parts.join(' ').replace(/\s+/g, ' ');
}

function findJsxInBody(
  body: ts.ConciseBody,
): ts.JsxElement | ts.JsxSelfClosingElement | null {
  if (ts.isJsxElement(body) || ts.isJsxSelfClosingElement(body)) {
    return body;
  }
  if (ts.isParenthesizedExpression(body)) {
    const inner = body.expression;
    if (ts.isJsxElement(inner) || ts.isJsxSelfClosingElement(inner)) {
      return inner;
    }
  }
  if (ts.isBlock(body)) {
    for (const stmt of body.statements) {
      if (!ts.isReturnStatement(stmt) || !stmt.expression) continue;
      const expr = stmt.expression;
      if (ts.isJsxElement(expr) || ts.isJsxSelfClosingElement(expr)) {
        return expr;
      }
      if (ts.isParenthesizedExpression(expr)) {
        const inner = expr.expression;
        if (ts.isJsxElement(inner) || ts.isJsxSelfClosingElement(inner)) {
          return inner;
        }
      }
    }
  }
  return null;
}
