"use strict"

const { flatten } = require('hoek');
const { Router } = require('call');

const compose = require('koa-compose');
const Boom = require('boom');
const Koa = require('koa');

class Bellboy {
  constructor(options) {
    this._router = new Router(options);
  }

  add({ path, action, method = 'GET', vhost = '*' }) {
    method = method.toLowerCase();
    this._router.add({ method, path, vhost }, this._mapAction(action));

    // For easy chaining
    return this;
  }

  _mapAction(action) {
    if (action instanceof Koa) {
      const { middleware } = action;
      if (Array.isArray(middleware) && middleware.length) return compose(middleware);
      throw new TypeError('Koa middleware you have passed as a handler is corrupted.');
    }

    if (Array.isArray(action)) return compose(flatten(action).map(this._mapAction));

    const type = typeof(action);
    if (type !== 'function') throw new TypeError(`Handler type is invalid: ${type}.`);

    const { length } = action;
    if (length < 1) throw new TypeError('Handler should accept at least 1 argument.');
    if (length > 2) throw new TypeError('Handler should accept 2 arguments at most.');
    return action;
  }

  export() {
    /**
     * Implied usage:
     *   // app/router.js
     *   ...
     *   module.exports = bellboyInstance.export();
     *
     *   // app/index.js
     *   const router = require('./router');
     *   app.use(router);
     */
    return async (context, next) => {
      let { method } = context.request;

      // Mapping request type just in case
      if (method === 'POST' && context.request.body && context.request.body._method) {
        context.request.method = context.request.body._method.toUpperCase();
        if (['GET', 'HEAD', 'PATCH', 'POST', 'PUT'].indexOf(context.request.method) === -1) {
          throw new Boom.methodNotAllowed('Only GET, HEAD, POST, PUT and PATCH are allowed.');
        }

        context.request._method = method;
        method = context.request.method;

        // Only cleaning the `_method` property to avoid body getting re-parsed
        delete context.request.body._method;
      }

      const match = this._router.route(method.toLowerCase(), context.request.path);
      if (!match) return await next();

      if (match instanceof Error) {
        // Any non-boom error at this point is pretty much impossible but you never know
        if (!match.isBoom) throw Boom.boomify(match, { statusCode: 500 });
        if (match.output.statusCode === 404) return await next();
        throw match;
      }

      // Impossible but better be safe than sorry
      if (!match.route) return await next();
      context.request.params = match.params;
      return await match.route(context, next);
    }
  }

  // Request helper methods

  get(config) {
    config.method = 'GET';
    return this.add(config);
  }

  head(config) {
    config.method = 'HEAD';
    return this.add(config);
  }

  patch(config) {
    config.method = 'PATCH';
    return this.add(config);
  }

  post(config) {
    config.method = 'POST';
    return this.add(config);
  }

  put(config) {
    config.method = 'PUT';
    return this.add(config);
  }
}

module.exports = Bellboy;
