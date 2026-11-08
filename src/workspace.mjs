import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { canonicalProjectHash, readSidecar } from './session-store.mjs';
import { contentProjectHash } from './project-save.mjs';
import { inspectExistingProject, prepareExistingProject } from './project-open.mjs';
import { listRecentProjects, recordRecentProject, removeRecentProject, clearRecentProjects } from './recent-projects.mjs';
import { getProjectLocationSettings, updateProjectLocationSettings, resolveProjectLocation, withProjectLocationSettings, inspectProjectFolder } from './project-locations.mjs';
import { previewDraft, createDraft, listDrafts, inspectDraft, prepareDraft } from './project-drafts.mjs';

const MAX_DOCUMENTS = 16, MAX_PLANS = 32;
const fail = (code, message, status = 422, details) => { throw Object.assign(new Error(message), { code, status, ...(details ? { details } : {}) }); };
function object(value, allowed) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_WORKSPACE_OPTIONS', 'Unknown or invalid workspace options.'); }
function boolean(value) { if (value !== undefined && typeof value !== 'boolean') fail('INVALID_WORKSPACE_OPTIONS', 'dryRun must be boolean.'); }
const point = context => context.saved?.checkpoint ?? null;
const dirty = context => context.draft ? true : point(context) ? contentProjectHash(context.engine.project) !== contentProjectHash(point(context).project) : null;
const stamp = context => context ? JSON.stringify({ project: canonicalProjectHash(context.engine.project), settings: context.settings?.revision, saveId: point(context)?.saveId ?? null, savedHash: point(context)?.projectHash ?? null, ownership: point(context)?.mediaOwnershipIds ?? null }) : null;
const sameFingerprint = (a, b) => ['sha256', 'dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => a[key] === b[key]);

/** The caller owns active route bindings and atomic publication. This manager
 * owns open-document membership, stable IDs and locks; parked documents are
 * never temporarily made active to perform a save or a timer backup. */
export function createWorkspace({ initial = null, captureActive, fromPrepared, adopt, deactivate, saveContext, acceptSaved, reserveTarget, runExclusive, emit, isClosed, recentPath, draftRegistryPath = recentPath ? `${recentPath}.drafts.json` : undefined, locationSettingsPath = recentPath ? `${recentPath}.locations.json` : undefined }) {
  for (const [name, value] of Object.entries({ captureActive, fromPrepared, adopt, deactivate, saveContext, reserveTarget, runExclusive, emit, isClosed })) if (typeof value !== 'function') fail('INVALID_WORKSPACE_CALLBACK', `${name} must be a function.`);
  const documents = new Map(), plans = new Map(); let activeId = null, revision = 0, locationSettings = null;
  function insert(context) {
    if (!context?.engine?.project || typeof context.projectPath !== 'string') fail('INVALID_DOCUMENT_CONTEXT', 'A document context requires an engine and project path.');
    const id = context.openId && !documents.has(context.openId) ? context.openId : randomUUID();
    context.openId = id; context.resources ??= 'initialized'; documents.set(id, context); return id;
  }
  if (initial) activeId = insert(initial);
  function syncActive() {
    const active = documents.get(activeId);
    if (active) { const current = captureActive(active); if (current) Object.assign(active, current, { openId: activeId }); }
  }
  function refreshSaved(context, saved) {
    context.saved = saved;
    if (context.documentState) context.documentState = { ...context.documentState, saved };
    acceptSaved?.(context, saved);
  }
  async function savedKey(filename) {
    try { return createHash('sha256').update(await readSidecar(`${filename}.saved.json`)).digest('hex'); }
    catch (error) { return `error:${error.code ?? error.name}`; }
  }
  async function inspectStableProject(filename, options, draftId) {
    if (draftId) { const inspected = await inspectDraft(draftRegistryPath, draftId, options); return { ...inspected, savedStateKey: `draft:${draftId}` }; }
    const before = await savedKey(filename), inspected = await inspectExistingProject(filename, options), after = await savedKey(inspected.projectPath);
    if (before !== after) fail('WORKSPACE_CONFLICT', 'The saved checkpoint changed during inspection. Inspect the action again.', 409);
    return { ...inspected, savedStateKey: after };
  }
  function summary(context) {
    const project = context.engine.project;
    return { id: context.openId, projectPath: context.draft ? null : context.projectPath, neverSaved: Boolean(context.draft), draftId: context.draft?.id ?? null,
      displayName: context.draft?.name ?? path.basename(context.projectPath), projectFolder: context.directory ?? path.dirname(context.projectPath), fileName: context.draft ? null : path.basename(context.projectPath), name: project.name, projectId: project.id, projectRevision: project.revision, active: context.openId === activeId,
      dirty: dirty(context), available: Boolean(context.saved?.available), saveId: point(context)?.saveId ?? null, resources: context.resources,
      autoBackup: structuredClone(context.autoBackup ?? null) };
  }
  function snapshot() { syncActive(); return { revision, activeId, documents: [...documents.values()].map(summary), locationSettings: structuredClone(locationSettings) }; }
  function contexts() { syncActive(); return [...documents.values()]; }
  function guard(input) {
    if (isClosed()) fail('SESSION_CLOSING', 'Workspace is closing.', 503);
    if (!Number.isSafeInteger(input.expectedWorkspaceRevision) || input.expectedWorkspaceRevision < 0) fail('EXPECTED_WORKSPACE_REVISION_REQUIRED', 'Provide expectedWorkspaceRevision from the workspace.');
    syncActive();
    if (input.expectedWorkspaceRevision !== revision) fail('WORKSPACE_CONFLICT', 'Open documents or the active document changed. Inspect the workspace again.', 409);
  }
  const targetContext = id => { const context = documents.get(id); if (!context) fail('OPEN_DOCUMENT_NOT_FOUND', 'This document is no longer open.', 404); return context; };
  async function findPath(filename) {
    for (const context of documents.values()) {
      let canonical; try { canonical = await fs.realpath(context.projectPath); } catch { canonical = path.resolve(context.projectPath); }
      if (canonical === filename) return context;
    }
    return null;
  }
  async function inspectContext(context, deferredMedia = true) {
    const inspected = await inspectStableProject(context.projectPath, { deferredMedia }, context.draft?.id);
    if (canonicalProjectHash(inspected.project) !== canonicalProjectHash(context.engine.project)) fail('PROJECT_FILE_CHANGED', 'An open project changed outside this workspace. Its in-memory state was retained.', 409);
    return inspected;
  }
  function targetSummary(context, inspected) {
    if (inspected.newDraft) return { id: null, projectPath: null, neverSaved: true, draftId: null, name: inspected.newDraft.name, displayName: inspected.newDraft.name, fileName: null, projectFolder: inspected.newDraft.projectFolder,
      projectId: null, projectRevision: 0, active: false, dirty: true, available: false, saveId: null, resources: 'deferred', autoBackup: null, tracks: 0, clips: 0, assets: 0, media: [] };
    const project = context?.engine.project ?? inspected.project;
    return { ...(context ? summary(context) : { id: null, projectPath: inspected.draft ? null : inspected.projectPath, neverSaved: Boolean(inspected.draft), draftId: inspected.draft?.id ?? null,
      displayName: inspected.draft?.name ?? path.basename(inspected.projectPath), fileName: inspected.draft ? null : path.basename(inspected.projectPath), projectFolder: inspected.directory,
      name: project.name, projectId: project.id, projectRevision: project.revision, active: false,
      dirty: inspected.saved.dirty, available: inspected.saved.available, saveId: inspected.saved.checkpoint?.saveId ?? null, resources: inspected.resources, autoBackup: null }),
      tracks: project.tracks.length, clips: project.clips.length, assets: project.assets.length, media: inspected.media.assets.map(asset => ({ id: asset.id, name: asset.name, status: asset.status })) };
  }
  async function keepPlan(kind, input, target, inspected) {
    const current = documents.get(activeId) ?? null, mode = input.mode, sameDocument = Boolean(target && target.openId === activeId);
    const policyContext = kind === 'close' ? target : (kind === 'activate' || mode === 'active') && !sameDocument ? current : null;
    // Only a transition away from the active document acts on that source.
    // Inactive open/close never performs costly media inspection of it.
    const source = kind !== 'close' && policyContext ? await inspectContext(current, true) : null;
    if (source) refreshSaved(current, source.saved);
    if (target) refreshSaved(target, inspected.saved);
    const sourceSavedKey = source?.savedStateKey ?? null;
    const targetSavedKey = inspected.savedStateKey;
    const id = randomUUID(), value = { id, kind, workspaceRevision: revision, ...(['open', 'new', 'recover'].includes(kind) ? { mode } : {}), current: current ? summary(current) : null,
      target: targetSummary(target, inspected), requiresCurrentPolicy: Boolean(policyContext && dirty(policyContext) !== false), policyTarget: policyContext ? kind === 'close' ? 'target' : 'current' : null,
      requiresSavePath: Boolean(policyContext?.draft),
      sameDocument, warnings: inspected.warnings, ...(inspected.location ? { location: { locationMode: inspected.location.locationMode, defaultLocation: inspected.location.defaultLocation, folderName: inspected.location.folderName, settingsRevision: inspected.location.settingsRevision } } : {}) };
    while (plans.size >= MAX_PLANS) plans.delete(plans.keys().next().value);
    plans.set(id, { value, currentId: activeId, currentStamp: stamp(current), targetId: target?.openId ?? null, targetStamp: stamp(target), fingerprint: inspected.fingerprint,
      sourceFingerprint: source?.fingerprint ?? null, sourceSavedKey, targetSavedKey, targetPath: inspected.projectPath ?? null, draftId: inspected.draft?.id ?? null, newDraft: inspected.newDraft ?? null, location: inspected.location ?? null });
    return structuredClone(value);
  }
  async function planOpen(input) {
    object(input, ['expectedWorkspaceRevision', 'projectPath', 'recentId', 'mode']);
    if (!['active', 'inactive'].includes(input.mode)) fail('INVALID_OPEN_MODE', 'Open mode must be active or inactive.');
    if ((typeof input.projectPath === 'string') === (typeof input.recentId === 'string')) fail('OPEN_TARGET_REQUIRED', 'Select one project path or recent entry.');
    return runExclusive(async () => {
      guard(input); let filename = input.projectPath;
      if (input.recentId !== undefined) { const recent = await listRecentProjects(recentPath, { inspect: false }), entry = recent.entries.find(item => item.id === input.recentId); if (!entry) fail('RECENT_ENTRY_NOT_FOUND', 'Recent entry no longer exists.', 404); filename = entry.projectPath; }
      const inspected = await inspectStableProject(filename, { deferredMedia: input.mode === 'inactive' }), existing = await findPath(inspected.projectPath);
      if (existing && canonicalProjectHash(existing.engine.project) !== canonicalProjectHash(inspected.project)) fail('PROJECT_FILE_CHANGED', 'The selected open project changed on disk.', 409);
      if (!existing && documents.size >= MAX_DOCUMENTS) fail('WORKSPACE_LIMIT', `At most ${MAX_DOCUMENTS} documents may be open. Close a document first.`);
      return keepPlan('open', input, existing, inspected);
    });
  }
  async function planTarget(kind, input) {
    object(input, ['expectedWorkspaceRevision', 'documentId']);
    return runExclusive(async () => {
      guard(input); const target = targetContext(input.documentId), inspected = await inspectContext(target, kind === 'close' || target.openId === activeId);
      return keepPlan(kind, input, target, inspected);
    });
  }
  const planActivate = input => planTarget('activate', input);
  const planClose = input => planTarget('close', input);
  async function planNew(input) {
    object(input, ['expectedWorkspaceRevision', 'projectFolder', 'location', 'expectedLocationRevision', 'sampleRate', 'mode']);
    if ((input.projectFolder !== undefined) === (input.location !== undefined)) fail('PROJECT_LOCATION_REQUIRED', 'Choose a direct projectFolder or a location preference selection.');
    if (input.location !== undefined) { object(input.location, ['folderName', 'chosenFolder']); if (!Number.isSafeInteger(input.expectedLocationRevision) || input.expectedLocationRevision < 0) fail('EXPECTED_LOCATION_REVISION_REQUIRED', 'Provide the location settings revision from the current profile.'); }
    else if (input.expectedLocationRevision !== undefined) fail('INVALID_WORKSPACE_OPTIONS', 'A direct folder does not use a location preference revision.');
    if (!['active', 'inactive'].includes(input.mode)) fail('INVALID_OPEN_MODE', 'Open mode must be active or inactive.');
    return runExclusive(async () => {
      guard(input); if (documents.size >= MAX_DOCUMENTS) fail('WORKSPACE_LIMIT', `At most ${MAX_DOCUMENTS} documents may be open.`);
      const location = input.location ? await resolveProjectLocation(locationSettingsPath, input.location) : null;
      if (location && location.settingsRevision !== input.expectedLocationRevision) fail('LOCATIONS_CONFLICT', 'Project location settings changed. Read them again before creating.', 409);
      if (location?.requiresPrompt) fail('PROJECT_LOCATION_REQUIRED', 'Select the project folder for this new project.');
      const preview = await previewDraft(draftRegistryPath, { projectFolder: location?.projectFolder ?? input.projectFolder, ...(input.sampleRate === undefined ? {} : { sampleRate: input.sampleRate }) });
      return keepPlan('new', input, null, { newDraft: preview, location, warnings: preview.warnings });
    });
  }
  async function planRecover(input) {
    object(input, ['expectedWorkspaceRevision', 'draftId', 'mode']);
    if (!['active', 'inactive'].includes(input.mode)) fail('INVALID_OPEN_MODE', 'Open mode must be active or inactive.');
    return runExclusive(async () => {
      guard(input); const inspected = await inspectStableProject(null, { deferredMedia: input.mode === 'inactive' }, input.draftId), existing = [...documents.values()].find(context => context.draft?.id === input.draftId) ?? null;
      if (existing && canonicalProjectHash(existing.engine.project) !== canonicalProjectHash(inspected.project)) fail('PROJECT_FILE_CHANGED', 'The open draft changed on disk.', 409);
      if (!existing && documents.size >= MAX_DOCUMENTS) fail('WORKSPACE_LIMIT', `At most ${MAX_DOCUMENTS} documents may be open.`);
      return keepPlan('recover', input, existing, inspected);
    });
  }
  async function verifyPlan(input, kind) {
    guard(input); const plan = plans.get(input.planId);
    if (!plan || plan.value.kind !== kind) fail('WORKSPACE_PLAN_NOT_FOUND', 'Inspect this workspace action before applying it.', 404);
    if (plan.value.workspaceRevision !== revision || plan.currentId !== activeId || plan.currentStamp !== stamp(documents.get(activeId) ?? null) ||
        (plan.targetId && plan.targetStamp !== stamp(targetContext(plan.targetId)))) fail('WORKSPACE_CONFLICT', 'A document changed since preview. Inspect the action again.', 409);
    if (plan.value.requiresCurrentPolicy && input.currentPolicy === undefined) fail('CURRENT_POLICY_REQUIRED', plan.value.policyTarget === 'target' ? 'Choose preserve or save for the document being closed.' : 'Choose preserve or save for the current document.');
    if (plan.value.requiresSavePath && input.currentPolicy === 'save' && !input.saveOutputPath) fail('SAVE_OUTPUT_PATH_REQUIRED', 'Choose a named project filename for this unsaved document before saving it.');
    const deferred = kind === 'close' || plan.value.mode === 'inactive' || plan.value.sameDocument;
    if (plan.sourceFingerprint) {
      const current = targetContext(plan.currentId), source = await inspectContext(current, true), key = source.savedStateKey;
      if (!sameFingerprint(source.fingerprint, plan.sourceFingerprint)) fail('PROJECT_FILE_CHANGED', 'The current working file changed outside this workspace. Inspect it again.', 409);
      if (key !== plan.sourceSavedKey) { refreshSaved(current, source.saved); plans.clear(); fail('WORKSPACE_CONFLICT', 'The current saved checkpoint changed after preview. Inspect the action again.', 409); }
    }
    if (kind === 'new') {
      if (plan.location) { const settings = await getProjectLocationSettings(locationSettingsPath); if (settings.settings.revision !== plan.location.settingsRevision || settings.fingerprint !== plan.location.settingsFingerprint) { locationSettings = settings; fail('LOCATIONS_CONFLICT', 'Project location settings changed after preview. Inspect the new project again.', 409); } await inspectProjectFolder(plan.location.locationMode === 'default' ? plan.location.defaultLocation : plan.location.projectFolder); }
      const preview = await previewDraft(draftRegistryPath, { projectFolder: plan.newDraft.projectFolder, sampleRate: plan.newDraft.sampleRate });
      if (preview.revision !== plan.newDraft.revision || preview.nextNumber !== plan.newDraft.nextNumber) fail('DRAFT_REGISTRY_CONFLICT', 'Draft numbering changed after preview. Inspect the new project again.', 409);
      await previewChosenSave(plan, input);
      return { plan, inspected: { newDraft: preview, warnings: preview.warnings } };
    }
    const inspected = await inspectStableProject(plan.targetPath, { deferredMedia: deferred }, plan.draftId);
    if (!sameFingerprint(inspected.fingerprint, plan.fingerprint)) fail('PROJECT_FILE_CHANGED', 'The target file changed after preview. Inspect it again.', 409);
    if (plan.targetId && canonicalProjectHash(inspected.project) !== canonicalProjectHash(targetContext(plan.targetId).engine.project)) fail('PROJECT_FILE_CHANGED', 'The open target no longer matches its file.', 409);
    if (inspected.savedStateKey !== plan.targetSavedKey) {
      if (plan.targetId) refreshSaved(targetContext(plan.targetId), inspected.saved);
      plans.clear(); fail('WORKSPACE_CONFLICT', 'The target saved checkpoint changed after preview. Inspect the action again.', 409);
    }
    await previewChosenSave(plan, input);
    return { plan, inspected };
  }
  async function previewChosenSave(plan, input) {
    if (input.dryRun && input.currentPolicy === 'save' && plan.value.requiresSavePath) {
      const context = targetContext(plan.value.policyTarget === 'target' ? plan.targetId : plan.currentId);
      await saveContext(context, input);
    }
  }
  function applyOptions(input) { object(input, ['expectedWorkspaceRevision', 'planId', 'currentPolicy', 'saveOutputPath', 'dryRun']); boolean(input.dryRun); if (input.currentPolicy !== undefined && !['preserve', 'save'].includes(input.currentPolicy)) fail('CURRENT_POLICY_REQUIRED', 'Choose preserve or save; workspace actions never discard project files.'); if (input.saveOutputPath !== undefined && (typeof input.saveOutputPath !== 'string' || !input.saveOutputPath.trim() || input.saveOutputPath.includes('\0'))) fail('SAVE_OUTPUT_PATH_REQUIRED', 'Choose a valid first-Save destination.'); }
  async function saveChosen(context, input) {
    if (!context || input.currentPolicy !== 'save') return false;
    const saved = await saveContext(context, input); if (saved?.checkpoint && Object.hasOwn(saved, 'available')) context.saved = saved;
    return true;
  }
  async function remember(context) {
    if (!recentPath || context.draft) return [];
    for (let attempt = 0; attempt < 3; attempt++) try {
      const recent = await listRecentProjects(recentPath, { inspect: false });
      if (recent.revision === null) fail('RECENT_UNAVAILABLE', 'Recent project registry is unavailable.');
      const result = await recordRecentProject(recentPath, context.projectPath, { expectedRegistryRevision: recent.revision }); return result.warnings ?? [];
    } catch (error) { if (error.status === 409 && attempt < 2) continue; return [{ code: 'RECENT_NOT_UPDATED', message: error.message }]; }
  }
  function response(status, applied, warnings = [], extra = {}) { return { status, applied, workspace: snapshot(), warnings, ...extra }; }
  async function activateContext(context, inspected, input, { newlyOpened = false } = {}) {
    const old = documents.get(activeId) ?? null, warnings = [...(inspected.warnings ?? [])]; let currentSaved = false, published = false;
    const candidate = { ...context, media: inspected.media, resources: 'initialized' };
    try {
      currentSaved = await saveChosen(old, input);
      if (currentSaved) warnings.push(...(old.saved?.persistence?.warnings ?? []));
      await adopt(candidate, () => {
        if (published) fail('WORKSPACE_PUBLICATION_ERROR', 'Document activation was published twice.');
        if (newlyOpened) insert(context);
        Object.assign(context, candidate); activeId = context.openId; revision++; plans.clear(); published = true;
      });
      if (!published) fail('WORKSPACE_PUBLICATION_ERROR', 'Activation did not publish its context.');
    } catch (error) {
      if (published) warnings.push({ code: 'ACTIVATED_WITH_WARNING', message: error.message });
      else {
        if (newlyOpened) try { await context.releaseLock?.(); } catch (releaseError) { error.warnings = [{ code: 'TARGET_LOCK_RELEASE_FAILED', message: releaseError.message }]; }
        if (currentSaved) { plans.clear(); emit(); }
        error.details = { ...error.details, activated: false, currentSaved, ...(newlyOpened ? { targetPrepared: true, preparedProjectPath: context.projectPath } : {}) }; throw error;
      }
    }
    warnings.push(...await remember(context)); emit(); return response(newlyOpened ? 'opened' : 'activated', true, warnings, { currentSaved });
  }
  async function executeOpen(input, kind) {
    applyOptions(input);
    return runExclusive(async () => {
      const { plan, inspected } = await verifyPlan(input, kind);
      if (input.dryRun) return response('validated', false, inspected.warnings, { plan: plan.value });
      const existing = plan.targetId ? targetContext(plan.targetId) : null;
      if (existing && (plan.value.mode === 'inactive' || existing.openId === activeId)) return response('unchanged', false, inspected.warnings);
      if (existing) return activateContext(existing, inspected, input);
      if (documents.size >= MAX_DOCUMENTS) fail('WORKSPACE_LIMIT', `At most ${MAX_DOCUMENTS} documents may be open.`);
      const makeDraft = async () => {
        // A selected existing base/final folder must not be silently recreated
        // when it disappears after preview. Repeat while the profile lease is
        // held; only the default mode's child folder may be newly created.
        if (plan.location) await inspectProjectFolder(plan.location.locationMode === 'default' ? plan.location.defaultLocation : plan.location.projectFolder);
        return createDraft(draftRegistryPath, { projectFolder: plan.newDraft.projectFolder, sampleRate: plan.newDraft.sampleRate, expectedRegistryRevision: plan.newDraft.revision, reserveTarget, ...(plan.location ? { existingFolder: plan.location.locationMode === 'default' ? plan.location.defaultLocation : plan.location.projectFolder } : {}) });
      };
      const prepared = kind === 'new' ? await (plan.location ? withProjectLocationSettings(locationSettingsPath, { expectedRevision: plan.location.settingsRevision, expectedFingerprint: plan.location.settingsFingerprint }, makeDraft) : makeDraft()) :
        kind === 'recover' ? await prepareDraft(draftRegistryPath, plan.draftId, { expectedFingerprint: plan.fingerprint, reserveTarget, deferredMedia: plan.value.mode === 'inactive' }) :
          await prepareExistingProject(inspected.projectPath, { expectedFingerprint: plan.fingerprint, reserveTarget, deferredMedia: plan.value.mode === 'inactive' });
      let context;
      try { context = await fromPrepared(prepared); if (!context?.engine?.project || typeof context.projectPath !== 'string') fail('INVALID_DOCUMENT_CONTEXT', 'fromPrepared did not return a usable context.'); context.releaseLock ??= prepared.releaseLock; context.saved ??= prepared.saved; context.draft ??= prepared.draft ?? null; context.resources = prepared.resources; context.openId = randomUUID(); }
      catch (error) { await prepared.releaseLock?.().catch(() => {}); throw error; }
      if (plan.value.mode === 'active') return activateContext(context, prepared, input, { newlyOpened: true });
      insert(context); revision++; plans.clear(); const warnings = [...prepared.warnings, ...await remember(context)]; emit(); return response('opened', true, warnings, { currentSaved: false });
    });
  }
  const open = input => executeOpen(input, 'open');
  const newDraft = input => executeOpen(input, 'new');
  const recover = input => executeOpen(input, 'recover');
  async function activate(input) {
    applyOptions(input);
    return runExclusive(async () => {
      const { plan, inspected } = await verifyPlan(input, 'activate');
      if (input.dryRun) return response('validated', false, inspected.warnings, { plan: plan.value });
      if (plan.value.sameDocument) return response('unchanged', false, inspected.warnings);
      return activateContext(targetContext(plan.targetId), inspected, input);
    });
  }
  async function close(input) {
    applyOptions(input);
    return runExclusive(async () => {
      const { plan, inspected } = await verifyPlan(input, 'close'), target = targetContext(plan.targetId);
      if (input.dryRun) return response('validated', false, inspected.warnings, { plan: plan.value });
      const targetSaved = await saveChosen(target, input), warnings = [...inspected.warnings, ...(targetSaved ? target.saved?.persistence?.warnings ?? [] : [])]; let published = false;
      const publish = () => { if (published) fail('WORKSPACE_PUBLICATION_ERROR', 'Document close was published twice.'); documents.delete(target.openId); if (activeId === target.openId) activeId = null; revision++; plans.clear(); published = true; };
      try { if (activeId === target.openId) { await deactivate(publish); if (!published) fail('WORKSPACE_PUBLICATION_ERROR', 'Close did not publish the inactive workspace.'); } else publish(); }
      catch (error) { if (!published) { if (targetSaved) emit(); error.details = { ...error.details, closed: false, targetSaved }; throw error; } warnings.push({ code: 'CLOSED_WITH_WARNING', message: error.message }); }
      try { await target.releaseLock?.(); } catch (error) { warnings.push({ code: 'DOCUMENT_LOCK_RELEASE_FAILED', message: error.message }); }
      emit(); return response('closed', true, warnings, { targetSaved, closedDocumentId: target.openId });
    });
  }
  function replaceActive(context) {
    // The caller has already adopted new globals. Capturing here would overwrite
    // the retired context with the replacement before removing its membership.
    const previous = activeId; if (previous) documents.delete(previous);
    activeId = context ? insert(context) : null; revision++; plans.clear(); return snapshot();
  }
  function contextChanged() { revision++; plans.clear(); return snapshot(); }
  async function locations() {
    try { locationSettings = await getProjectLocationSettings(locationSettingsPath); }
    catch (error) { locationSettings = { status: 'unavailable', settings: null, fingerprint: null, warnings: [{ code: error.code ?? 'LOCATIONS_UNAVAILABLE', message: error.message }] }; }
    return structuredClone(locationSettings);
  }
  async function changeLocations(input) {
    object(input, ['expectedWorkspaceRevision', 'expectedRevision', 'defaultLocation', 'locationMode', 'dryRun']); boolean(input.dryRun);
    return runExclusive(async () => {
      guard(input); const { expectedWorkspaceRevision, ...options } = input;
      const result = await updateProjectLocationSettings(locationSettingsPath, options);
      if (!input.dryRun) { await locations(); emit(); }
      return result;
    });
  }
  async function recent() { return listRecentProjects(recentPath); }
  async function drafts() { return listDrafts(draftRegistryPath); }
  async function changeRecent(input) {
    object(input, ['expectedWorkspaceRevision', 'expectedRegistryRevision', 'entryId', 'clear', 'dryRun']); boolean(input.dryRun);
    if (input.clear !== undefined && typeof input.clear !== 'boolean') fail('INVALID_WORKSPACE_OPTIONS', 'clear must be boolean.');
    if (input.clear === true ? input.entryId !== undefined : typeof input.entryId !== 'string') fail('INVALID_RECENT_OPTIONS', 'Select an entry or explicitly clear the recent list.');
    return runExclusive(async () => { guard(input); const options = { expectedRegistryRevision: input.expectedRegistryRevision, dryRun: Boolean(input.dryRun) };
      const result = input.clear === true ? await clearRecentProjects(recentPath, options) : await removeRecentProject(recentPath, input.entryId, options); if (!input.dryRun) emit(); return result; });
  }
  return { snapshot, contexts, replaceActive, contextChanged, remember, planOpen, open, planNew, new: newDraft, planRecover, recover, planActivate, activate, planClose, close, recent, changeRecent, drafts, locations, changeLocations };
}
