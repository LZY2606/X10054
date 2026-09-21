import {
  type DotASTNode,
  DotSyntaxError,
  parse,
  stringify,
} from '@ts-graphviz/ast';

const ast: DotASTNode = parse('digraph { a -> b; }');
const printed: string = stringify(ast);

try {
  parse('this is not dot');
} catch (error) {
  if (error instanceof DotSyntaxError) {
    const message: string = error.message;
    void message;
  }
}

void printed;
