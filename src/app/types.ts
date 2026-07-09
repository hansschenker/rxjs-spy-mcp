export interface Model {
  searchQuery: string;
  activeQuery: string | null;
  results: string[];
  isLoading: boolean;
  errorMessage: string | null;
  requestCount: number;
}

export type Msg =
  | { type: 'INIT' }
  | { type: 'SET_QUERY'; query: string }
  | { type: 'START_SEARCH'; query: string }
  | { type: 'SEARCH_SUCCESS'; query: string; results: string[] }
  | { type: 'SEARCH_FAILURE'; query: string; error: string };

export const initialModel: Model = {
  searchQuery: '',
  activeQuery: null,
  results: [],
  isLoading: false,
  errorMessage: null,
  requestCount: 0
};

export type Dispatch = (msg: Msg) => void;
