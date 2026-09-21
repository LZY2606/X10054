import {
  type EdgeModel,
  isEdgeModel,
  isNodeModel,
  isNodeRef,
  isNodeRefGroupLike,
  type NodeRef,
  type NodeRefGroup,
  toNodeRef,
  toNodeRefGroup,
} from '@ts-graphviz/common';

const ref: NodeRef = toNodeRef('n1');
const group: NodeRefGroup = toNodeRefGroup([toNodeRef('a'), toNodeRef('b')]);

const refIsNodeRef: boolean = isNodeRef(ref);
const groupLooksLikeRefGroup: boolean = isNodeRefGroupLike(group);

const narrowEdge: (value: unknown) => value is EdgeModel = isEdgeModel;
const narrowNode: (value: unknown) => boolean = isNodeModel;

void refIsNodeRef;
void groupLooksLikeRefGroup;
void narrowEdge;
void narrowNode;
