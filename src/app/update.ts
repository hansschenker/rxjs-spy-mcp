import type { Model, Msg } from './types';

export function update(model: Model, msg: Msg): Model {
  switch (msg.type) {
    case 'INIT':
      return model;

    case 'SET_QUERY':
      return {
        ...model,
        searchQuery: msg.query,
        errorMessage: null
      };

    case 'START_SEARCH':
      return {
        ...model,
        activeQuery: msg.query,
        isLoading: true,
        errorMessage: null,
        requestCount: model.requestCount + 1
      };

    case 'SEARCH_SUCCESS':
      if (model.activeQuery !== msg.query) return model;

      return {
        ...model,
        results: msg.results,
        isLoading: false,
        errorMessage: null
      };

    case 'SEARCH_FAILURE':
      if (model.activeQuery !== msg.query) return model;

      return {
        ...model,
        results: [],
        isLoading: false,
        errorMessage: msg.error
      };
  }
}
