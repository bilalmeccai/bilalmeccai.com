/* ════════════════════════════════════════
   BILALMECCAI.COM — SHARED JS
════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  /* ── NAV SCROLL ── */
  const nav = document.querySelector('.site-nav');
  if (nav) {
    window.addEventListener('scroll', () => {
      nav.classList.toggle('scrolled', window.scrollY > 40);
    }, { passive: true });
  }

  /* ── HAMBURGER ── */
  const hamburger = document.querySelector('.nav__hamburger');
  const mobileMenu = document.getElementById('mobileMenu');
  let menuOpen = false;

  if (hamburger && mobileMenu) {
    const openMenu = () => {
      menuOpen = true;
      hamburger.classList.add('open');
      hamburger.setAttribute('aria-expanded', 'true');
      mobileMenu.style.display = 'flex';
      requestAnimationFrame(() => mobileMenu.classList.add('open'));
      document.body.style.overflow = 'hidden';
    };
    const closeMenu = () => {
      menuOpen = false;
      hamburger.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
      mobileMenu.classList.remove('open');
      document.body.style.overflow = '';
      setTimeout(() => { if (!menuOpen) mobileMenu.style.display = 'none'; }, 300);
    };

    hamburger.addEventListener('click', () => menuOpen ? closeMenu() : openMenu());
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && menuOpen) closeMenu(); });

    mobileMenu.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', closeMenu);
    });
  }

  /* ── SCROLL REVEAL ── */
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && reveals.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          setTimeout(() => entry.target.classList.add('visible'), i * 70);
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    reveals.forEach(el => io.observe(el));
  } else {
    reveals.forEach(el => el.classList.add('visible'));
  }

  /* ── CUSTOM CURSOR (desktop / pointer device only) ── */
  if (window.matchMedia('(pointer: fine)').matches) {
    const cursor = document.getElementById('cursor');
    const ring   = document.getElementById('cursorRing');
    if (cursor && ring) {
      let mx = -100, my = -100, rx = -100, ry = -100;
      document.addEventListener('mousemove', e => {
        mx = e.clientX; my = e.clientY;
        cursor.style.left = mx - 4 + 'px';
        cursor.style.top  = my - 4 + 'px';
      });
      const animRing = () => {
        rx += (mx - rx) * 0.12;
        ry += (my - ry) * 0.12;
        ring.style.left = rx - 17 + 'px';
        ring.style.top  = ry - 17 + 'px';
        requestAnimationFrame(animRing);
      };
      animRing();
      document.querySelectorAll('a, button, [role="button"]').forEach(el => {
        el.addEventListener('mouseenter', () => { cursor.style.transform = 'scale(2.5)'; ring.style.opacity = '0.18'; });
        el.addEventListener('mouseleave', () => { cursor.style.transform = 'scale(1)';   ring.style.opacity = '0.35'; });
      });
    }
  }

  /* ── SMOOTH ANCHORS ── */
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  });

  /* ── COPY CODE BLOCKS ── */
  document.querySelectorAll('pre').forEach(pre => {
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy code');
    pre.style.position = 'relative';
    pre.appendChild(btn);
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(pre.innerText.replace('Copy', '').trim()).then(() => {
        btn.textContent = 'Copied ✓';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
      });
    });
  });

});
