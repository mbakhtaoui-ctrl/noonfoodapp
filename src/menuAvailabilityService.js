"use strict";
const { EventEmitter } = require("events");

/**
 * MenuAvailabilityService
 * - In-memory source of truth for menu item availability by restaurant
 * - Emits real-time events on changes so downstream consumers (e.g., consumer app)
 *   can receive updates immediately via SSE/WebSocket/etc.
 * - Keeps a bounded per-restaurant changelog to allow replay since a timestamp
 */
class MenuAvailabilityService extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {() => number} [options.clock] - injectable clock for tests
   * @param {number} [options.retentionMs] - how long to keep changes for replay
   * @param {number} [options.maxChangesPerRestaurant] - cap to avoid unbounded memory
   */
  constructor(options = {}) {
    super();
    this.clock = options.clock || (() => Date.now());
    this.retentionMs = options.retentionMs || 24 * 60 * 60 * 1000; // 24h
    this.maxChangesPerRestaurant = options.maxChangesPerRestaurant || 5000;

    // State shape: Map<restaurantId, Map<itemId, { inStock: boolean, updatedAt: number, version: number }>>
    this.state = new Map();

    // Changelog shape: Map<restaurantId, Array<{ ts:number, restaurantId:string, itemId:string, inStock:boolean, version:number }>>
    this.changelog = new Map();
  }

  /**
   * Ensure nested map exists
   * @private
   */
  _ensureRestaurant(restaurantId) {
    if (!this.state.has(restaurantId)) this.state.set(restaurantId, new Map());
    if (!this.changelog.has(restaurantId)) this.changelog.set(restaurantId, []);
  }

  /**
   * Get current availability for an item
   * @param {string} restaurantId
   * @param {string} itemId
   */
  getAvailability(restaurantId, itemId) {
    const r = this.state.get(restaurantId);
    if (!r) return null;
    const rec = r.get(itemId);
    return rec ? { ...rec } : null;
  }

  /**
   * Get snapshot for a restaurant
   * @param {string} restaurantId
   * @returns {{ restaurantId: string, items: Record<string, {inStock:boolean, updatedAt:number, version:number}> }}
   */
  getSnapshot(restaurantId) {
    const r = this.state.get(restaurantId) || new Map();
    const items = {};
    for (const [itemId, rec] of r.entries()) items[itemId] = { ...rec };
    return { restaurantId, items };
  }

  /**
   * Get changes strictly after a timestamp (ms since epoch)
   * @param {string} restaurantId
   * @param {number} sinceTs
   * @returns {Array}
   */
  getChangesSince(restaurantId, sinceTs) {
    const list = this.changelog.get(restaurantId) || [];
    return list.filter((e) => e.ts > sinceTs).map((e) => ({ ...e }));
  }

  /**
   * Set availability and emit an event if changed, or when notifyAlways=true
   * @param {string} restaurantId
   * @param {string} itemId
   * @param {boolean} inStock
   * @param {Object} [meta]
   * @param {boolean} [meta.notifyAlways]
   * @param {string} [meta.partnerId]
   * @param {string} [meta.correlationId]
   * @param {string} [meta.reason]
   * @returns {{changed:boolean, record: {inStock:boolean, updatedAt:number, version:number}}}
   */
  setAvailability(restaurantId, itemId, inStock, meta = {}) {
    if (!restaurantId || !itemId) throw new Error("restaurantId and itemId are required");
    this._ensureRestaurant(restaurantId);

    const rMap = this.state.get(restaurantId);
    const now = this.clock();

    const isNew = !rMap.has(itemId);
    const current = rMap.get(itemId) || { inStock: undefined, updatedAt: 0, version: 0 };
    const changed = isNew || current.inStock !== inStock;

    const next = {
      inStock,
      updatedAt: now,
      version: (current.version || 0) + (changed ? 1 : 0),
    };

    rMap.set(itemId, next);

    const event = {
      type: "availability.changed",
      restaurantId,
      itemId,
      inStock: next.inStock,
      updatedAt: next.updatedAt,
      version: next.version,
      meta: {
        partnerId: meta.partnerId || null,
        correlationId: meta.correlationId || null,
        reason: meta.reason || null,
      },
      ts: now,
    };

    // Maintain bounded, time-pruned changelog for replay
    const clog = this.changelog.get(restaurantId);
    clog.push(event);
    const cutoff = now - this.retentionMs;
    while (clog.length && (clog.length > this.maxChangesPerRestaurant || clog[0].ts <= cutoff)) {
      clog.shift();
    }

    if (changed || meta.notifyAlways) {
      // Emit event for real-time propagation
      this.emit("availability.changed", event);
    }

    return { changed, record: { ...next } };
  }
}

module.exports = { MenuAvailabilityService };
