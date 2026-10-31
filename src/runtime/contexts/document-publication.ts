/** Private identities stay distinct while asynchronous work retains them. */
export type DocumentGeneration = object;

export interface DocumentPublicationState {
  generation: DocumentGeneration;
  started: boolean;
  ready: boolean;
  published: boolean;
  loaded: boolean;
}

export function cancelDocumentPublication(state: DocumentPublicationState): void {
  state.generation = {};
  state.ready = false;
  state.started = false;
  state.published = false;
  state.loaded = false;
}

export function beginDocumentPublication(
  state: DocumentPublicationState,
): DocumentGeneration {
  const generation = {};
  state.generation = generation;
  state.started = true;
  state.loaded = false;
  return generation;
}
