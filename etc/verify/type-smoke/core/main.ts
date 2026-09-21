import type { RootGraphModel, SubgraphModel } from '@ts-graphviz/common';
import { Digraph, registerDefault } from '@ts-graphviz/core';

registerDefault();

const graph: RootGraphModel = new Digraph('Typed');
graph.edge(['a', 'b'], { label: 'typed edge' });
graph.node('a', { shape: 'box' });

const subgraph: SubgraphModel = graph.subgraph('cluster_inner', (cluster) => {
  cluster.set('label', 'inner');
});

void subgraph;
