/**
 * OriginFill — Settings Page Logic
 * Full settings management: profiles, personal info, education, work experience,
 * resume upload, skills, extension settings, data export/import, and about.
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

(async function SettingsInit() {
  'use strict';

  // ─── DOM Helpers ───────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ─── State ─────────────────────────────────────────────────────
  let profiles = [];
  let activeProfile = null;
  let settings = {};
  let currentSection = 'profiles';

  // ─── Initialize ────────────────────────────────────────────────
  async function init() {
    try {
      // Initialize UI first so the page is usable even if storage fails
      applyTheme();
      setupNavigation();
      setupEventListeners();

      // Initialize storage
      await OriginFillStore.initialize();
      profiles = await OriginFillStore.getProfiles();
      settings = await OriginFillStore.getSettings();
      activeProfile = profiles.find(p => p.id === settings.activeProfileId) || profiles[0] || null;

      // Populate data
      renderProfiles();
      if (activeProfile) loadProfileData(activeProfile);
      loadExtensionSettings();

      // Set version
      $('versionText').textContent = `v${chrome.runtime.getManifest().version}`;
      $('aboutVersion').textContent = `Version ${chrome.runtime.getManifest().version}`;

      // Mark first run as complete
      await OriginFillStore.completeFirstRun();
    } catch (error) {
      console.error('[OriginFill][Settings] Initialization failed:', error);
      
      // Ensure basic UI is visible if everything crashed
      $('versionText').textContent = `v${chrome.runtime.getManifest().version}`;
      showToast('❌', 'Failed to load settings data. See console.');
    }
  }

  // ─── Navigation ────────────────────────────────────────────────
  function setupNavigation() {
    const navItems = $$('.settings__nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const section = item.dataset.section;
        showSection(section);
        // Update active nav
        navItems.forEach(n => n.classList.remove('settings__nav-item--active'));
        item.classList.add('settings__nav-item--active');
        item.setAttribute('aria-current', 'page');
      });
    });

    // Handle hash navigation
    const hash = window.location.hash.slice(1);
    if (hash) showSection(hash);
  }

  function showSection(name) {
    const sections = $$('.settings__section');
    sections.forEach(s => s.hidden = true);
    const target = $(`section-${name}`);
    if (target) {
      target.hidden = false;
      currentSection = name;
    }
  }

  // ─── Profiles ──────────────────────────────────────────────────
  function renderProfiles() {
    const list = $('profilesList');
    if (!list) return;

    list.innerHTML = profiles.map(p => `
      <div class="settings__profile-card ${p.id === activeProfile?.id ? 'settings__profile-card--active' : ''}"
           data-profile-id="${p.id}">
        <div class="settings__profile-color" style="background: ${p.colorTag || '#2563EB'}"></div>
        <div class="settings__profile-info">
          <div class="settings__profile-name">${escapeHtml(p.label)}</div>
          ${p.isDefault ? '<div class="settings__profile-default">Default</div>' : ''}
        </div>
        <div class="settings__profile-actions">
          <button class="settings__btn settings__btn--sm settings__btn--ghost" data-action="edit" data-id="${p.id}" title="Edit">✏️</button>
          <button class="settings__btn settings__btn--sm settings__btn--ghost" data-action="duplicate" data-id="${p.id}" title="Duplicate">📋</button>
          ${profiles.length > 1 ? `<button class="settings__btn settings__btn--sm settings__btn--ghost" data-action="delete" data-id="${p.id}" title="Delete">🗑️</button>` : ''}
        </div>
      </div>
    `).join('');

    // Profile card click — switch active
    list.querySelectorAll('.settings__profile-card').forEach(card => {
      card.addEventListener('click', async (e) => {
        if (e.target.closest('[data-action]')) return; // Don't switch on button click
        const id = card.dataset.profileId;
        await switchProfile(id);
      });
    });

    // Profile action buttons
    list.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (action === 'edit') { await switchProfile(id); showSection('personal'); updateNavHighlight('personal'); }
        if (action === 'duplicate') { await duplicateProfile(id); }
        if (action === 'delete') { await deleteProfileWithConfirm(id); }
      });
    });
  }

  async function switchProfile(id) {
    activeProfile = profiles.find(p => p.id === id);
    if (!activeProfile) return;
    await OriginFillStore.setActiveProfile(id);
    settings.activeProfileId = id;
    loadProfileData(activeProfile);
    renderProfiles();
  }

  async function duplicateProfile(id) {
    const dup = await OriginFillStore.duplicateProfile(id);
    profiles = await OriginFillStore.getProfiles();
    renderProfiles();
    showToast('✅', `Profile "${dup.label}" created`);
  }

  async function deleteProfileWithConfirm(id) {
    const profile = profiles.find(p => p.id === id);
    if (!profile) return;
    showDialog(
      'Delete Profile',
      `Are you sure you want to delete "${profile.label}"? This cannot be undone.`,
      async () => {
        await OriginFillStore.deleteProfile(id);
        profiles = await OriginFillStore.getProfiles();
        settings = await OriginFillStore.getSettings();
        activeProfile = profiles.find(p => p.id === settings.activeProfileId) || profiles[0];
        if (activeProfile) loadProfileData(activeProfile);
        renderProfiles();
        showToast('🗑️', 'Profile deleted');
      }
    );
  }

  function updateNavHighlight(section) {
    $$('.settings__nav-item').forEach(n => {
      n.classList.toggle('settings__nav-item--active', n.dataset.section === section);
    });
  }

  // ─── Load Profile Data into Forms ──────────────────────────────
  function loadProfileData(profile) {
    if (!profile) return;
    // Personal
    const p = profile.personal || {};
    setVal('personalFirstName', p.firstName);
    setVal('personalLastName', p.lastName);
    setVal('personalFullName', p.fullName);
    setVal('personalEmail', p.email);
    setVal('personalPhone', p.phone);
    setVal('personalAddress', p.address);
    setVal('personalCity', p.city);
    setVal('personalState', p.state);
    setVal('personalZipCode', p.zipCode);
    setVal('personalCountry', p.country);
    setVal('personalLinkedIn', p.linkedIn);
    setVal('personalGithub', p.github);
    setVal('personalPortfolio', p.portfolio || (p.websites && p.websites.length > 0 ? p.websites[0] : ''));
    setVal('personalWebsites', (p.websites || []).join('\n') || (p.portfolio ? p.portfolio : ''));

    // Skills
    setVal('skillsInput', (profile.skills || []).join(', '));
    setVal('languagesInput', (profile.languages || []).join(', '));
    setVal('certificationsInput', (profile.certifications || []).join(', '));

    // Education entries
    renderEducationEntries(profile.education || []);

    // Work entries
    renderWorkEntries(profile.workExperience || []);

    // Resumes
    loadResumes();
  }

  function setVal(id, value) {
    const el = $(id);
    if (el) el.value = value || '';
  }

  // ─── Education Entries ─────────────────────────────────────────
  function renderEducationEntries(entries) {
    const container = $('educationEntries');
    if (!container) return;

    container.innerHTML = entries.map((edu, i) => `
      <div class="settings__entry" data-index="${i}">
        <div class="settings__entry-header">
          <div>
            <div class="settings__entry-title">${escapeHtml(edu.institution || `Education ${i + 1}`)}</div>
            <div class="settings__entry-subtitle">${escapeHtml(edu.degree || '')} ${edu.fieldOfStudy ? '· ' + escapeHtml(edu.fieldOfStudy) : ''}</div>
          </div>
        </div>
        <div class="settings__entry-body">
          <div class="settings__field">
            <label class="settings__label">Institution</label>
            <input class="settings__input edu-field" type="text" data-field="institution" data-index="${i}" value="${escapeHtml(edu.institution || '')}" placeholder="University name">
          </div>
          <div class="settings__row settings__row--2col">
            <div class="settings__field">
              <label class="settings__label">Degree</label>
              <select class="settings__select edu-field" data-field="degree" data-index="${i}">
                <option value="">Select degree</option>
                <option value="High School Diploma" ${edu.degree === 'High School Diploma' ? 'selected' : ''}>High School Diploma</option>
                <option value="Associate's" ${edu.degree === "Associate's" ? 'selected' : ''}>Associate's</option>
                <option value="Bachelor's" ${edu.degree === "Bachelor's" ? 'selected' : ''}>Bachelor's</option>
                <option value="Master's" ${edu.degree === "Master's" ? 'selected' : ''}>Master's</option>
                <option value="PhD" ${edu.degree === 'PhD' ? 'selected' : ''}>PhD</option>
                <option value="MBA" ${edu.degree === 'MBA' ? 'selected' : ''}>MBA</option>
                <option value="Other" ${edu.degree === 'Other' ? 'selected' : ''}>Other</option>
              </select>
            </div>
            <div class="settings__field">
              <label class="settings__label">Field of Study</label>
              <input class="settings__input edu-field" type="text" data-field="fieldOfStudy" data-index="${i}" value="${escapeHtml(edu.fieldOfStudy || '')}" placeholder="Computer Science">
            </div>
          </div>
          <div class="settings__row settings__row--3col">
            <div class="settings__field">
              <label class="settings__label">Start Year</label>
              <input class="settings__input edu-field" type="text" data-field="startYear" data-index="${i}" value="${escapeHtml(edu.startYear || '')}" placeholder="2018">
            </div>
            <div class="settings__field">
              <label class="settings__label">End Year</label>
              <input class="settings__input edu-field" type="text" data-field="endYear" data-index="${i}" value="${escapeHtml(edu.endYear || '')}" placeholder="2022">
            </div>
            <div class="settings__field">
              <label class="settings__label">GPA</label>
              <input class="settings__input edu-field" type="text" data-field="gpa" data-index="${i}" value="${escapeHtml(edu.gpa || '')}" placeholder="3.8">
            </div>
          </div>
          <div class="settings__field">
            <label class="settings__label">Location</label>
            <input class="settings__input edu-field" type="text" data-field="location" data-index="${i}" value="${escapeHtml(edu.location || '')}" placeholder="San Francisco, CA">
          </div>
        </div>
        <div class="settings__entry-actions">
          <button class="settings__btn settings__btn--sm settings__btn--ghost edu-save" data-index="${i}">Save</button>
          ${entries.length > 1 ? `<button class="settings__btn settings__btn--sm settings__btn--danger edu-delete" data-index="${i}">Remove</button>` : ''}
        </div>
      </div>
    `).join('');

    // Save buttons
    container.querySelectorAll('.edu-save').forEach(btn => {
      btn.addEventListener('click', () => saveEducation(parseInt(btn.dataset.index)));
    });

    // Delete buttons
    container.querySelectorAll('.edu-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteEducation(parseInt(btn.dataset.index)));
    });
  }

  async function saveEducation(index) {
    if (!activeProfile) return;
    const fields = document.querySelectorAll(`.edu-field[data-index="${index}"]`);
    const edu = {};
    fields.forEach(f => { edu[f.dataset.field] = f.value; });

    if (!activeProfile.education) activeProfile.education = [];
    activeProfile.education[index] = { ...(activeProfile.education[index] || {}), ...edu };

    await OriginFillStore.updateProfile(activeProfile.id, { education: activeProfile.education });
    profiles = await OriginFillStore.getProfiles();
    activeProfile = profiles.find(p => p.id === activeProfile.id);
    renderEducationEntries(activeProfile.education);
    showToast('✅', 'Education saved');
  }

  async function addEducation() {
    if (!activeProfile) return;
    if (!activeProfile.education) activeProfile.education = [];
    activeProfile.education.push({ institution: '', degree: '', fieldOfStudy: '', startYear: '', endYear: '', gpa: '', location: '' });
    await OriginFillStore.updateProfile(activeProfile.id, { education: activeProfile.education });
    profiles = await OriginFillStore.getProfiles();
    activeProfile = profiles.find(p => p.id === activeProfile.id);
    renderEducationEntries(activeProfile.education);
  }

  async function deleteEducation(index) {
    if (!activeProfile || !activeProfile.education) return;
    activeProfile.education.splice(index, 1);
    if (activeProfile.education.length === 0) {
      activeProfile.education.push({ institution: '', degree: '', fieldOfStudy: '', startYear: '', endYear: '', gpa: '', location: '' });
    }
    await OriginFillStore.updateProfile(activeProfile.id, { education: activeProfile.education });
    profiles = await OriginFillStore.getProfiles();
    activeProfile = profiles.find(p => p.id === activeProfile.id);
    renderEducationEntries(activeProfile.education);
    showToast('🗑️', 'Education entry removed');
  }

  // ─── Work Experience Entries ───────────────────────────────────
  function renderWorkEntries(entries) {
    const container = $('workEntries');
    if (!container) return;

    container.innerHTML = entries.map((work, i) => `
      <div class="settings__entry" data-index="${i}">
        <div class="settings__entry-header">
          <div>
            <div class="settings__entry-title">${escapeHtml(work.jobTitle || `Position ${i + 1}`)}</div>
            <div class="settings__entry-subtitle">${escapeHtml(work.company || '')}</div>
          </div>
        </div>
        <div class="settings__entry-body">
          <div class="settings__row settings__row--2col">
            <div class="settings__field">
              <label class="settings__label">Company</label>
              <input class="settings__input work-field" type="text" data-field="company" data-index="${i}" value="${escapeHtml(work.company || '')}" placeholder="Google">
            </div>
            <div class="settings__field">
              <label class="settings__label">Job Title</label>
              <input class="settings__input work-field" type="text" data-field="jobTitle" data-index="${i}" value="${escapeHtml(work.jobTitle || '')}" placeholder="Software Engineer">
            </div>
          </div>
          <div class="settings__row settings__row--2col">
            <div class="settings__field">
              <label class="settings__label">Start Date</label>
              <input class="settings__input work-field" type="text" data-field="startDate" data-index="${i}" value="${escapeHtml(work.startDate || '')}" placeholder="2022-01">
            </div>
            <div class="settings__field">
              <label class="settings__label">End Date</label>
              <input class="settings__input work-field" type="text" data-field="endDate" data-index="${i}" value="${escapeHtml(work.endDate || '')}" placeholder="Present" ${work.isCurrent ? 'disabled' : ''}>
            </div>
          </div>
          <div class="settings__toggle-row" style="padding: 8px 0; border: none;">
            <span class="settings__toggle-label" style="font-size: 13px;">Currently working here</span>
            <label class="settings__switch">
              <input type="checkbox" class="work-field" data-field="isCurrent" data-index="${i}" ${work.isCurrent ? 'checked' : ''}>
              <span class="settings__switch-slider"></span>
            </label>
          </div>
          <div class="settings__field">
            <label class="settings__label">Location</label>
            <input class="settings__input work-field" type="text" data-field="location" data-index="${i}" value="${escapeHtml(work.location || '')}" placeholder="Mountain View, CA">
          </div>
          <div class="settings__field">
            <label class="settings__label">Description / Bullet Points <span class="settings__label-hint">(one per line, max 6)</span></label>
            <textarea class="settings__textarea work-field" data-field="bullets" data-index="${i}" rows="4" placeholder="• Led development of...">${(work.bullets || []).join('\n')}</textarea>
          </div>
        </div>
        <div class="settings__entry-actions">
          <button class="settings__btn settings__btn--sm settings__btn--ghost work-save" data-index="${i}">Save</button>
          ${entries.length > 1 ? `<button class="settings__btn settings__btn--sm settings__btn--danger work-delete" data-index="${i}">Remove</button>` : ''}
        </div>
      </div>
    `).join('');

    // Save
    container.querySelectorAll('.work-save').forEach(btn => {
      btn.addEventListener('click', () => saveWork(parseInt(btn.dataset.index)));
    });

    // Delete
    container.querySelectorAll('.work-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteWork(parseInt(btn.dataset.index)));
    });

    // isCurrent toggle — disable end date
    container.querySelectorAll('[data-field="isCurrent"]').forEach(toggle => {
      toggle.addEventListener('change', () => {
        const idx = toggle.dataset.index;
        const endDate = container.querySelector(`[data-field="endDate"][data-index="${idx}"]`);
        if (endDate) {
          endDate.disabled = toggle.checked;
          if (toggle.checked) endDate.value = 'Present';
        }
      });
    });
  }

  async function saveWork(index) {
    if (!activeProfile) return;
    const fields = document.querySelectorAll(`.work-field[data-index="${index}"]`);
    const work = {};
    fields.forEach(f => {
      if (f.dataset.field === 'isCurrent') {
        work.isCurrent = f.checked;
      } else if (f.dataset.field === 'bullets') {
        work.bullets = f.value.split('\n').map(l => l.replace(/^[•\-]\s*/, '').trim()).filter(Boolean).slice(0, 6);
      } else {
        work[f.dataset.field] = f.value;
      }
    });

    if (!activeProfile.workExperience) activeProfile.workExperience = [];
    activeProfile.workExperience[index] = { ...(activeProfile.workExperience[index] || {}), ...work };

    await OriginFillStore.updateProfile(activeProfile.id, { workExperience: activeProfile.workExperience });
    profiles = await OriginFillStore.getProfiles();
    activeProfile = profiles.find(p => p.id === activeProfile.id);
    renderWorkEntries(activeProfile.workExperience);
    showToast('✅', 'Work experience saved');
  }

  async function addWork() {
    if (!activeProfile) return;
    if (!activeProfile.workExperience) activeProfile.workExperience = [];
    activeProfile.workExperience.push({ company: '', jobTitle: '', startDate: '', endDate: '', isCurrent: false, location: '', bullets: [''] });
    await OriginFillStore.updateProfile(activeProfile.id, { workExperience: activeProfile.workExperience });
    profiles = await OriginFillStore.getProfiles();
    activeProfile = profiles.find(p => p.id === activeProfile.id);
    renderWorkEntries(activeProfile.workExperience);
  }

  async function deleteWork(index) {
    if (!activeProfile || !activeProfile.workExperience) return;
    activeProfile.workExperience.splice(index, 1);
    if (activeProfile.workExperience.length === 0) {
      activeProfile.workExperience.push({ company: '', jobTitle: '', startDate: '', endDate: '', isCurrent: false, location: '', bullets: [''] });
    }
    await OriginFillStore.updateProfile(activeProfile.id, { workExperience: activeProfile.workExperience });
    profiles = await OriginFillStore.getProfiles();
    activeProfile = profiles.find(p => p.id === activeProfile.id);
    renderWorkEntries(activeProfile.workExperience);
    showToast('🗑️', 'Work entry removed');
  }

  // ─── Resume Upload ─────────────────────────────────────────────
  let pendingResumeFile = null;

  async function loadResumes() {
    if (!activeProfile) return;
    const resumes = await OriginFillStore.getResumes(activeProfile.id);
    const list = $('resumesList');
    if (!list) return;

    list.innerHTML = resumes.map(r => `
      <div class="settings__resume-card" data-resume-id="${r.id}">
        <span class="settings__resume-icon">📄</span>
        <div class="settings__resume-info">
          <div class="settings__resume-name">${escapeHtml(r.label || r.fileName)}</div>
          <div class="settings__resume-meta">${escapeHtml(r.fileName)} · Uploaded ${new Date(r.uploadedAt).toLocaleDateString()}</div>
        </div>
        <button class="settings__btn settings__btn--sm settings__btn--ghost resume-delete" data-id="${r.id}" title="Delete">🗑️</button>
      </div>
    `).join('');

    // Check limit
    const uploadBtn = $('uploadResumeBtn');
    if (resumes.length >= 3) {
      uploadBtn.disabled = true;
      uploadBtn.title = 'Maximum 3 resumes';
    }

    // Delete buttons
    list.querySelectorAll('.resume-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        await OriginFillStore.deleteResume(btn.dataset.id);
        loadResumes();
        showToast('🗑️', 'Resume deleted');
      });
    });
  }

  async function uploadResume() {
    if (!pendingResumeFile || !activeProfile) return;

    const label = $('resumeLabel').value.trim() || pendingResumeFile.name;

    // Read file as base64
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1]; // Remove data:... prefix

      const resumeData = {
        id: 'resume_' + Date.now().toString(36),
        label,
        fileName: pendingResumeFile.name,
        fileData: base64,
        uploadedAt: new Date().toISOString()
      };

      await OriginFillStore.saveResume(activeProfile.id, resumeData);
      pendingResumeFile = null;
      $('resumeLabel').value = '';
      $('uploadResumeBtn').disabled = true;
      loadResumes();
      showToast('✅', `Resume "${label}" uploaded`);
    };

    reader.readAsDataURL(pendingResumeFile);
  }

  // ─── Event Listeners ──────────────────────────────────────────
  function setupEventListeners() {
    // Add profile
    $('addProfileBtn').addEventListener('click', async () => {
      const label = prompt('Profile name:');
      if (label && label.trim()) {
        await OriginFillStore.createProfile(label.trim());
        profiles = await OriginFillStore.getProfiles();
        renderProfiles();
        showToast('✅', `Profile "${label.trim()}" created`);
      }
    });

    // Save personal info
    $('savePersonalBtn').addEventListener('click', async () => {
      if (!activeProfile) return;
      const personal = {
        firstName: $('personalFirstName').value,
        lastName: $('personalLastName').value,
        fullName: $('personalFullName').value || `${$('personalFirstName').value} ${$('personalLastName').value}`.trim(),
        email: $('personalEmail').value,
        phone: $('personalPhone').value,
        address: $('personalAddress').value,
        city: $('personalCity').value,
        state: $('personalState').value,
        zipCode: $('personalZipCode').value,
        country: $('personalCountry').value,
        linkedIn: $('personalLinkedIn').value,
        github: $('personalGithub').value,
        portfolio: $('personalPortfolio').value,
        websites: $('personalWebsites').value.split('\n').map(s => s.trim()).filter(Boolean)
      };
      await OriginFillStore.updateProfile(activeProfile.id, { personal, websites: $('personalWebsites').value.split('\n').map(s => s.trim()).filter(Boolean) });

      profiles = await OriginFillStore.getProfiles();
      activeProfile = profiles.find(p => p.id === activeProfile.id);
      showToast('✅', 'Personal info saved');
    });

    // Save skills
    $('saveSkillsBtn').addEventListener('click', async () => {
      if (!activeProfile) return;
      
      const normalizeInput = (raw) => {
        if (!raw) return [];
        // 1. Replace newlines with commas to avoid concatenating lines
        // 2. Replace colons (categories) with commas
        let text = raw.replace(/[\n\r]+/g, ',').replace(/:\s*/g, ',');
        return text.split(',')
          .map(s => s.trim().replace(/\.+$/, '').trim())
          .filter(Boolean);
      };

      const skills = normalizeInput($('skillsInput').value);
      const languages = normalizeInput($('languagesInput').value);
      const certifications = normalizeInput($('certificationsInput').value);
      
      await OriginFillStore.updateProfile(activeProfile.id, { skills, languages, certifications });
      profiles = await OriginFillStore.getProfiles();
      activeProfile = profiles.find(p => p.id === activeProfile.id);
      showToast('✅', 'Skills saved');
    });

    // Add education / work
    $('addEducationBtn').addEventListener('click', addEducation);
    $('addWorkBtn').addEventListener('click', addWork);

    // Resume upload
    const fileInput = $('resumeFileInput');
    $('browseBtn').addEventListener('click', (e) => { e.preventDefault(); fileInput.click(); });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (file) {
        if (file.size > 5 * 1024 * 1024) {
          showToast('⚠️', 'File too large (max 5MB)');
          return;
        }
        pendingResumeFile = file;
        $('uploadResumeBtn').disabled = false;
        if (!$('resumeLabel').value) $('resumeLabel').value = file.name.replace(/\.[^.]+$/, '');
      }
    });

    $('uploadResumeBtn').addEventListener('click', uploadResume);

    // Drag & drop
    const uploadZone = $('uploadZone');
    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('settings__upload-zone--dragover'); });
    uploadZone.addEventListener('dragleave', () => { uploadZone.classList.remove('settings__upload-zone--dragover'); });
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.classList.remove('settings__upload-zone--dragover');
      const file = e.dataTransfer.files[0];
      if (file) {
        if (file.size > 5 * 1024 * 1024) { showToast('⚠️', 'File too large'); return; }
        pendingResumeFile = file;
        $('uploadResumeBtn').disabled = false;
        if (!$('resumeLabel').value) $('resumeLabel').value = file.name.replace(/\.[^.]+$/, '');
      }
    });

    // Extension settings
    $('fillDelaySlider').addEventListener('input', (e) => {
      $('fillDelayValue').textContent = e.target.value;
    });

    $('saveExtSettingsBtn').addEventListener('click', async () => {
      settings.autoDetect = $('toggleAutoDetect').checked;
      settings.autoFillOnDetect = $('toggleAutoFill').checked;
      settings.showNotifications = $('toggleNotifications').checked;
      settings.recoveryEnabled = $('toggleRecovery').checked;
      settings.fillDelay = parseInt($('fillDelaySlider').value, 10);
      settings.theme = $('themeSelect').value;
      await OriginFillStore.saveSettings(settings);
      applyTheme();
      showToast('✅', 'Settings saved');
    });

    // Export
    $('exportDataBtn').addEventListener('click', async () => {
      const data = await OriginFillStore.exportAllData();
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `originfill_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('✅', 'Data exported');
    });

    // Import
    $('importDataBtn').addEventListener('click', () => $('importFileInput').click());
    $('importFileInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      try {
        const data = JSON.parse(text);
        await OriginFillStore.importData(data, false);
        profiles = await OriginFillStore.getProfiles();
        settings = await OriginFillStore.getSettings();
        activeProfile = profiles.find(p => p.id === settings.activeProfileId) || profiles[0];
        renderProfiles();
        if (activeProfile) loadProfileData(activeProfile);
        loadExtensionSettings();
        showToast('✅', 'Data imported');
      } catch (err) {
        showToast('❌', 'Invalid file: ' + err.message);
      }
    });

    // Clear all data
    $('clearDataBtn').addEventListener('click', () => {
      showDialog(
        'Clear All Data',
        'Are you sure? This will permanently delete all profiles, settings, and saved data. This action cannot be undone.',
        async () => {
          await OriginFillStore.clearAllData();
          await OriginFillStore.initialize();
          profiles = await OriginFillStore.getProfiles();
          settings = await OriginFillStore.getSettings();
          activeProfile = profiles[0] || null;
          renderProfiles();
          if (activeProfile) loadProfileData(activeProfile);
          loadExtensionSettings();
          showToast('🗑️', 'All data cleared');
        }
      );
    });
  }

  // ─── Load Extension Settings into Form ─────────────────────────
  function loadExtensionSettings() {
    $('toggleAutoDetect').checked = settings.autoDetect !== false;
    $('toggleAutoFill').checked = settings.autoFillOnDetect === true;
    $('toggleNotifications').checked = settings.showNotifications !== false;
    $('toggleRecovery').checked = settings.recoveryEnabled !== false;
    $('fillDelaySlider').value = settings.fillDelay || 300;
    $('fillDelayValue').textContent = settings.fillDelay || 300;
    $('themeSelect').value = settings.theme || 'system';
  }

  // ─── Theme ─────────────────────────────────────────────────────
  function applyTheme() {
    chrome.storage.local.get('originfill_settings', (result) => {
      const s = result.originfill_settings || {};
      if (s.theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      else if (s.theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
      else document.documentElement.removeAttribute('data-theme');
    });
  }

  // ─── Dialog ────────────────────────────────────────────────────
  let dialogCallback = null;

  function showDialog(title, text, onConfirm) {
    $('dialogTitle').textContent = title;
    $('dialogText').textContent = text;
    dialogCallback = onConfirm;
    $('confirmDialog').showModal();
  }

  $('dialogConfirmBtn').addEventListener('click', async () => {
    $('confirmDialog').close();
    if (dialogCallback) await dialogCallback();
    dialogCallback = null;
  });

  $('dialogCancelBtn').addEventListener('click', () => {
    $('confirmDialog').close();
    dialogCallback = null;
  });

  // ─── Toast ─────────────────────────────────────────────────────
  let toastTimer = null;

  function showToast(icon, text) {
    $('toastIcon').textContent = icon;
    $('toastText').textContent = text;
    $('toast').hidden = false;

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
  }

  // ─── Utility ───────────────────────────────────────────────────
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Run ───────────────────────────────────────────────────────
  await init();
})();
