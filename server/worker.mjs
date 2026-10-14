import { handleAIRequest } from './ai.mjs';

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname.startsWith('/api/')) return handleAIRequest(request, env);
    return env.ASSETS.fetch(request);
  }
};
