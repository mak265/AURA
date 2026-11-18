import { useEffect, useState } from 'react';
import api from '../api/client';
import ProfilePosts from './ProfilePosts';

export default function SavedPosts({ onUnsave }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [error, setError] = useState('');
  const [pageError, setPageError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api.get('/feed', { params: { scope: 'saved' }, signal: controller.signal })
      .then(({ data }) => {
        setPosts(data);
        setCursor(data.length === 50 ? data.at(-1).save_cursor : null);
      })
      .catch(() => { if (!controller.signal.aborted) setError('Could not load saved posts. Reopen Saved to try again.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function loadMore() {
    setLoadingMore(true);
    setPageError('');
    try {
      const { data } = await api.get('/feed', { params: { scope: 'saved', before: cursor } });
      setPosts(previous => [...previous, ...data]);
      setCursor(data.length === 50 ? data.at(-1).save_cursor : null);
    } catch {
      setPageError('Could not load more saved posts. Try again.');
    } finally {
      setLoadingMore(false);
    }
  }

  return <>
    <div className="you-section-heading"><div><h2>Saved posts</h2><p>Only you can see what you save.</p></div></div>
    <ProfilePosts posts={posts} savedList loading={loading} error={error}
      onUnsave={id => {
        setPosts(previous => previous.filter(post => post.id !== id));
        onUnsave(id);
      }}/>
    {pageError && <p role="alert" className="mt-3 text-sm text-red-400">{pageError}</p>}
    {cursor && <button className="aura-btn-secondary mt-4 !py-3" type="button" disabled={loadingMore} onClick={loadMore}>
      {loadingMore ? 'Loading…' : 'Load more'}
    </button>}
  </>;
}
