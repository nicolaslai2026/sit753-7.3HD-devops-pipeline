const POLL_MS = 20000;         
let allClasses = [];          
let lastTrigger = null;      

const $ = (id) => document.getElementById(id);

//  1. Load + render classes
async function loadClasses() {
  try {
    const res = await fetch('/api/classes');
    allClasses = await res.json();
    renderClasses();
    $('classList').setAttribute('aria-busy', 'false');
  } catch {
    $('classList').innerHTML = '<p class="loading">Could not load classes. Is the server running?</p>';
  }
}

function renderClasses() {
  const term = $('searchInput').value.trim().toLowerCase();
  const list = allClasses.filter((c) =>
    !term ||
    c.name.toLowerCase().includes(term) ||
    c.ageGroup.toLowerCase().includes(term)
  );

  const container = $('classList');

  if (list.length === 0) {
    container.innerHTML = '<p class="loading">No classes match your search.</p>';
    return;
  }

  container.innerHTML = list.map(cardHTML).join('');

  list.forEach((c) => {
    const btn = document.querySelector(`[data-action][data-id="${c.id}"]`);
    if (btn) btn.addEventListener('click', () => openModal(c, btn));
  });
}

function cardHTML(c) {
  let badgeText, action, btnLabel, btnClass;

  if (c.status === 'full') {
    badgeText = 'Full';
    action = 'waitlist'; btnLabel = 'Join waitlist'; btnClass = 'btn-waitlist';
  } else if (c.status === 'limited') {
    badgeText = `${c.remaining} spot${c.remaining === 1 ? '' : 's'} left!`;
    action = 'book'; btnLabel = 'Book now'; btnClass = 'btn-book';
  } else {
    badgeText = `${c.remaining} spots left`;
    action = 'book'; btnLabel = 'Book now'; btnClass = 'btn-book';
  }

  return `
    <article class="class-card">
      <div class="class-info">
        <h3>${escapeHTML(c.name)}</h3>
        <p class="class-meta">${escapeHTML(c.day)} ${escapeHTML(c.time)} · ${escapeHTML(c.ageGroup)}
           · <span class="class-price">$${c.price}/class</span></p>
      </div>
      <div class="class-right">
        <span class="badge ${c.status}">${badgeText}</span>
        <button class="btn ${btnClass}" data-action="${action}" data-id="${c.id}">${btnLabel}</button>
      </div>
    </article>`;
}

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])
  );
}

//  2. Modal open / close
function openModal(cls, trigger) {
  lastTrigger = trigger;
  $('classId').value = cls.id;

  // Summary panel
  $('modalTitle').textContent = (cls.status === 'full' ? 'Join waitlist: ' : 'Book: ') + cls.name;
  $('summaryWhen').textContent = `${cls.day} ${cls.time}`;
  $('summaryPrice').textContent = `$${cls.price}/class`;
  updateSpotSummary(cls);

  // Reset form + views
  $('bookingForm').reset();
  $('spots').value = 1;
  $('spots').max = Math.max(cls.remaining, 1);
  clearErrors();
  $('formError').hidden = true;

  // Full class -> waitlist mode
  $('spots').closest('.field').hidden = (cls.status === 'full');

  showView('booking');
  $('modalBackdrop').hidden = false;
  setTimeout(() => $('name').focus(), 50);   // a11y: focus first field
}

function updateSpotSummary(cls) {
  const el = $('summarySpots');
  if (cls.status === 'full') {
    el.textContent = 'This class is full — join the waitlist below.';
  } else {
    el.textContent = `${cls.remaining} spot${cls.remaining === 1 ? '' : 's'} remaining`;
  }
}

function closeModal() {
  $('modalBackdrop').hidden = true;
  if (lastTrigger) lastTrigger.focus();      // a11y: return focus to trigger
}

function showView(which) {
  $('bookingView').hidden  = which !== 'booking';
  $('confirmView').hidden  = which !== 'confirm';
  $('waitlistView').hidden = which !== 'waitlist';
}

//  3. Client-side validation 
function clearErrors() {
  ['name', 'email', 'spots'].forEach((f) => {
    $(f).classList.remove('invalid');
    const e = $(f + 'Err');
    if (e) e.hidden = true;
  });
}

function validate(isWaitlist) {
  clearErrors();
  let ok = true;

  if (!$('name').value.trim()) {
    $('name').classList.add('invalid'); $('nameErr').hidden = false; ok = false;
  }
  const email = $('email').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    $('email').classList.add('invalid'); $('emailErr').hidden = false; ok = false;
  }
  if (!isWaitlist) {
    const spots = Number($('spots').value);
    const max = Number($('spots').max);
    if (!Number.isInteger(spots) || spots < 1) {
      $('spots').classList.add('invalid');
      $('spotsErr').textContent = 'Enter at least 1 spot.';
      $('spotsErr').hidden = false; ok = false;
    } else if (spots > max) {
      $('spots').classList.add('invalid');
      $('spotsErr').textContent = `Only ${max} spot(s) remaining.`;
      $('spotsErr').hidden = false; ok = false;
    }
  }
  return ok;
}

//  4. Submit :book or join waitlist
$('bookingForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const classId = Number($('classId').value);
  const cls = allClasses.find((c) => c.id === classId);
  const isWaitlist = cls && cls.status === 'full';

  if (!validate(isWaitlist)) return;

  const payload = {
    classId,
    name: $('name').value.trim(),
    email: $('email').value.trim(),
    phone: $('phone').value.trim(),
  };
  if (!isWaitlist) payload.spots = Number($('spots').value);

  const btn = $('confirmBtn');
  btn.disabled = true;
  btn.textContent = isWaitlist ? 'Joining…' : 'Booking…';   // loading state -> no double submit
  $('formError').hidden = true;

  try {
    const endpoint = isWaitlist ? '/api/waitlist' : '/api/bookings';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      if (data.offerWaitlist) {
        showWaitlistOption(cls);
      } else {
        $('formError').textContent = data.error || 'Something went wrong.';
        $('formError').hidden = false;
      }
      return;
    }

    if (isWaitlist) {
      $('waitlistClass').textContent = cls.name;
      showView('waitlist');
    } else {
      $('confirmClass').textContent = `${data.className} · ${data.when}`;
      $('confirmRef').textContent = data.refCode;
      $('confirmNote').textContent = buildConfirmNote(data);
      prepareCalendar(data);
      showView('confirm');
    }

    loadClasses();  
  } catch {
    $('formError').textContent = 'Network error — please try again.';
    $('formError').hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirm booking';
  }
});

function buildConfirmNote(data) {
  return data.emailSent
    ? 'A confirmation email has been sent to your inbox.'
    : 'Your confirmation email has been prepared.';
}

// If the class just filled, switch the form into waitlist mode inline.
function showWaitlistOption(cls) {
  $('formError').textContent = 'This class just filled up — you can join the waitlist instead.';
  $('formError').hidden = false;
  if (cls) { cls.status = 'full'; $('spots').closest('.field').hidden = true; }
}

//  5. "Add to calendar" : build an iCal (.ics) download on the fly
let calendarBlobUrl = null;
function prepareCalendar(data) {
  const event = parseWhenToDates(data.when);

  const fmt = (d) =>
    d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0') + 'T' +
    String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0') + '00';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MMM Art Studio//Booking//EN',
    'BEGIN:VEVENT',
    `UID:${data.refCode}@mmm-art-studio`,           
    `DTSTAMP:${fmt(new Date())}`,                   
    `DTSTART:${fmt(event.start)}`,                
    `DTEND:${fmt(event.end)}`,                      
    `SUMMARY:${data.className} (MMM Art Studio)`,
    `DESCRIPTION:Booking reference ${data.refCode}`,
    'LOCATION:MMM Art Studio',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  const ics = lines.join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar' });
  if (calendarBlobUrl) URL.revokeObjectURL(calendarBlobUrl);
  calendarBlobUrl = URL.createObjectURL(blob);
}

function parseWhenToDates(when) {
  const days = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

  const dayMatch = String(when).slice(0, 3).toLowerCase();
  const targetDay = days[dayMatch] ?? new Date().getDay();

  const times = String(when).match(/\d{1,2}:\d{2}\s*[ap]m/gi) || [];
  const start = nextWeekdayAt(targetDay, times[0] || '10:00am');
  const end = times[1]
    ? nextWeekdayAt(targetDay, times[1])
    : new Date(start.getTime() + 90 * 60 * 1000); 
  return { start, end };
}

function nextWeekdayAt(targetDay, timeStr) {
  const m = timeStr.match(/(\d{1,2}):(\d{2})\s*([ap])m/i);
  let hour = m ? Number(m[1]) : 10;
  const min = m ? Number(m[2]) : 0;
  const pm = m && m[3].toLowerCase() === 'p';
  if (pm && hour !== 12) hour += 12;     
  if (!pm && hour === 12) hour = 0;     

  const d = new Date();
  const diff = (targetDay - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  d.setHours(hour, min, 0, 0);
  return d;
}

//  6. Event wiring
$('modalClose').addEventListener('click', closeModal);
$('backToClasses').addEventListener('click', closeModal);
$('waitlistBack').addEventListener('click', closeModal);
$('searchInput').addEventListener('input', renderClasses);

$('addCalendar').addEventListener('click', () => {
  if (!calendarBlobUrl) return;
  const a = document.createElement('a');
  a.href = calendarBlobUrl; a.download = 'mmm-art-studio-class.ics';
  a.click();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('modalBackdrop').hidden) closeModal();
});
$('modalBackdrop').addEventListener('click', (e) => {
  if (e.target === $('modalBackdrop')) closeModal();
});

//  7. Boot + live polling
loadClasses();
setInterval(() => {
  if ($('modalBackdrop').hidden) loadClasses();
}, POLL_MS);
