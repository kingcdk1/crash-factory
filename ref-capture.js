/* The Crash Factory - referral capture (Five Stone standard).
   Reads ?ref=NAME from the URL, stores it first-touch in localStorage so the
   original referrer sticks across pages and visits, and attributes leads. */
(function () {
  try {
    var m = (location.search || '').match(/[?&]ref=([^&]+)/i);
    if (m) {
      var name = decodeURIComponent(m[1]).replace(/\+/g, ' ').trim();
      if (name && !localStorage.getItem('cf_ref')) localStorage.setItem('cf_ref', name);
    }
  } catch (e) {}

  function ref() { try { return localStorage.getItem('cf_ref') || ''; } catch (e) { return ''; } }
  window.cfRef = ref; // forms read this to attribute the lead

  // Auto-fill a hidden "referred_by" field on any form (e.g. the contact form).
  var v = ref();
  if (v) {
    var el = document.getElementById('cfContactRef');
    if (el && !el.value) el.value = v;
  }
})();
