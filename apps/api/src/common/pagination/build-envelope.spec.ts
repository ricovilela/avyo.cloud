import { buildEnvelope } from './build-envelope';

describe('buildEnvelope', () => {
  it('wraps rows under exactly one entity key with single-page meta', () => {
    const rows = [
      { id: '1', code: 'a' },
      { id: '2', code: 'b' },
      { id: '3', code: 'c' },
    ];

    const envelope = buildEnvelope('color_class', rows);

    expect(Object.keys(envelope)).toEqual(['data', 'links', 'meta']);
    expect(Object.keys(envelope.data)).toEqual(['color_class']);
    expect(envelope.data.color_class).toBe(rows);
    expect(envelope.meta).toEqual({
      current_page: 1,
      from: 1,
      last_page: 1,
      per_page: 3,
      to: 3,
      total: 3,
    });
    expect(envelope.links).toEqual({
      first: '',
      last: '',
      prev: null,
      next: null,
    });
  });

  it('reports null from/to and zero per_page/total for an empty set', () => {
    const envelope = buildEnvelope('official_color', []);

    expect(envelope.data.official_color).toEqual([]);
    expect(envelope.meta).toEqual({
      current_page: 1,
      from: null,
      last_page: 1,
      per_page: 0,
      to: null,
      total: 0,
    });
    expect(envelope.links).toEqual({
      first: '',
      last: '',
      prev: null,
      next: null,
    });
  });

  it('sets per_page and total to the row count for a single-row set', () => {
    const envelope = buildEnvelope('color_class', [{ id: '1' }]);

    expect(envelope.meta.per_page).toBe(1);
    expect(envelope.meta.total).toBe(1);
    expect(envelope.meta.from).toBe(1);
    expect(envelope.meta.to).toBe(1);
  });
});
