// Chapter controls share the existing player; seeking never opens a second one.
export function renderVideoChapters(container, project, getVideo, openPlayer) {
  container._chapterCleanup?.();
  container._chapterCleanup = null;
  container.replaceChildren();
  container._chapterReset = null;
  const native = Boolean(project?.videoSrc);
  const embedded = /^BV[a-zA-Z0-9]+$/.test(project?.bvid || '');
  container.hidden = !(native || embedded) || !project.videoChapters?.length;
  if (container.hidden) return;
  const chapters = project.videoChapters;
  const controls = [];
  let observedVideo;
  function update(time = 0) {
    let current = 0;
    chapters.forEach((chapter, index) => { if (time >= chapter.time) current = index; });
    controls.forEach((button, index) => button.setAttribute('aria-pressed', String(index === current)));
  }
  function observe(video) {
    if (!video || video === observedVideo) return;
    observedVideo = video;
    video.addEventListener('timeupdate', () => {
      if (container.isConnected && video === getVideo()) update(video.currentTime);
    });
  }
  chapters.forEach(chapter => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.time = chapter.time;
    const timestamp = document.createElement('span');
    timestamp.className = 'chapter-time';
    timestamp.dataset.noTranslate = '';
    timestamp.textContent = `${String(Math.floor(chapter.time / 60)).padStart(2, '0')}:${String(chapter.time % 60).padStart(2, '0')}`;
    const label = document.createElement('span');
    label.textContent = chapter.label;
    button.append(timestamp, label);
    button.addEventListener('click', () => {
      if (!native) {
        // The iframe exposes no playback clock. This records the selected start.
        openPlayer(chapter.time);
        update(chapter.time);
        return;
      }
      if (!getVideo()) openPlayer();
      const video = getVideo();
      if (!video) return;
      observe(video);
      const seek = () => {
        if (!video.isConnected) return;
        video.currentTime = Math.min(chapter.time, Math.max(0, video.duration - 0.05));
        update(video.currentTime);
        video.play().catch(() => {});
      };
      if (video.readyState >= 1) seek();
      else video.addEventListener('loadedmetadata', seek, {once: true});
    });
    controls.push(button);
    container.append(button);
  });
  // A normal click on the poster should update the active chapter too.
  const mediaPanel = container.parentElement.querySelector('.project-preview');
  const onPlay = event => { if (event.target.tagName === 'VIDEO') observe(event.target); };
  if (native) mediaPanel?.addEventListener('play', onPlay, true);
  container._chapterReset = () => update(0);
  // Re-rendering the controls drops the old panel listener.
  container._chapterCleanup = () => {
    mediaPanel?.removeEventListener('play', onPlay, true);
    container._chapterReset = null;
  };
  update();
}
