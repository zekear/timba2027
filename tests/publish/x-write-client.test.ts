import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadMedia, createTweet } from '../../src/publish/x-write-client.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('uploadMedia', () => {
  it('returns media_id_string from successful upload', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { id: '1234567890' } }), { status: 200 }),
    );
    const buffer = Buffer.from('fake-png');
    const id = await uploadMedia(buffer, 'image/png');
    expect(id).toBe('1234567890');
  });

  it('throws on non-2xx response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 }),
    );
    const buffer = Buffer.from('fake-png');
    await expect(uploadMedia(buffer, 'image/png')).rejects.toThrow(/401/);
  });
});

describe('createTweet', () => {
  it('posts tweet with media_ids and returns tweet id', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { id: '9876', text: 'Hello' } }), { status: 201 }),
    );
    const id = await createTweet({ text: 'Hello', mediaIds: ['1234567890'] });
    expect(id).toBe('9876');
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain('/2/tweets');
    const body = JSON.parse(call[1].body);
    expect(body.text).toBe('Hello');
    expect(body.media.media_ids).toEqual(['1234567890']);
  });

  it('posts tweet without media when mediaIds empty', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { id: '4567', text: 'No media' } }), { status: 201 }),
    );
    const id = await createTweet({ text: 'No media', mediaIds: [] });
    expect(id).toBe('4567');
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.media).toBeUndefined();
  });
});
