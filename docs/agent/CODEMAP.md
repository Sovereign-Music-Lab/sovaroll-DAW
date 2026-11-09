# CODEMAP (generated — do not edit by hand)

Regenerate: `npm run agent:map`. Line counts help you choose `show.mjs` ranges; files with a large *max line* contain very long single lines — use `find.mjs`/`show.mjs`, never retype them.

## src/core/

Engine core: project schema, validation, command application, undo history. Pure functions, no I/O.

| file | lines | max line | exports |
|---|---:|---:|---|
| audio-time-base.mjs | 16 | 377 | replaceEffectiveTempo, setAudioTimeBase |
| controller-paint.mjs | 48 | 359 | replaceControllerPaint |
| controllers.mjs | 212 | 720 | normalizeEditedCurves, normalizeInsertedCurves, applyControllers |
| editing.mjs | 603 | 777 | MAX_COPIED_NOTES, quantizeReferenceFits, invalidateOutsideQuantizeReferences, nearestGrid, applyEditing |
| engine.mjs | 1078 | 879 | createProject, validateProject, Engine, EngineError, getCommandCatalog |
| merge.mjs | 94 | 399 | applyMerge |
| midi-events.mjs | 91 | 286 | midiObjectIds, hasMidiSourceOrdering, validateMidiClipEvents, midiEventUsage, validateMidiEventBudget, checkMidiEventCopies, addMidiEvents, splitMidiEvents, MAX_MIDI_EVENTS, MAX_MIDI_EVENT_BYTES, MAX_MIDI_PAYLOAD_BYTES |
| midi-input-edit.mjs | 24 | 266 | applyMidiInputEdit |
| midi-time-base.mjs | 38 | 362 | retimeLinearMidi |
| modifiers.mjs | 42 | 356 | applyModifiers |
| schema.mjs | 319 | 1315 | EngineError, fail, MAX_MIDI_EVENTS, MAX_MIDI_EVENT_BYTES, MAX_MIDI_PAYLOAD_BYTES, projectSchema, envelopeSchema, createOptionsSchema, validateSchema, validateCommand, getCommandCatalog |
| track-folders.mjs | 44 | 627 | orderedArrangementSiblings, applyTrackFolders, validateTrackFolders |
| track-time-base-default.mjs | 8 | 144 | applyNewTrackTimeBase |

## src/media/

Media & time math: WAV/AIFF/MIDI codecs, offline renderer, tempo/time conversion, controller curves. Mostly pure.

| file | lines | max line | exports |
|---|---:|---:|---|
| aiff.mjs | 50 | 524 | encodeAiff, decodeAiff |
| asset-limits.mjs | 4 | 82 | MAX_WAV_FILE_BYTES, MAX_MIDI_FILE_BYTES |
| audio-clip-peak.mjs | 11 | 332 | audioClipPeak |
| audio-fade.mjs | 23 | 115 | fadeCurve, audioFadeGain, audioEnvelopeGain |
| audio-overlap.mjs | 14 | 435 | compileAudioFrontSpans |
| audio-processing-provenance.mjs | 13 | 496 | appendAudioProcessingProvenance, readAudioProcessingProvenance |
| audio-silence.mjs | 13 | 308 | isFrameSilenced, editSilenceRanges |
| audio-statistics.mjs | 23 | 559 | audioClipStatistics |
| common.mjs | 35 | 105 | mediaError, requireValue, integer, finite, asBytes, ascii |
| controller-bend.mjs | 32 | 138 | describeControllerSegment, bendControllerCurve |
| controller-paint.mjs | 97 | 218 | compileControllerPaint |
| controller-readout.mjs | 130 | 239 | buildControllerReadoutIndex, queryControllerReadout, formatPitchBendValue, createControllerReadoutCache |
| controller-shape-gesture.mjs | 52 | 344 | compileControllerShapeGesture |
| controller-shapes.mjs | 126 | 283 | compileControllerShape, generateControllerShape, quantizedControllerPeriod, translateControllerShape |
| controller-thin.mjs | 23 | 239 | planControllerThinning |
| controller-time-gesture.mjs | 71 | 169 | compileControllerTimeGesture |
| controller-time-insertion.mjs | 15 | 245 | planControllerTimeInsertion |
| display-time-edit.mjs | 75 | 275 | formatDisplayTicks, parseDisplayTicks, resolveDisplayTimeCommand |
| dissolve-display.mjs | 16 | 364 | optimizeDissolvedPart |
| editor-geometry.mjs | 244 | 729 | compileEditorGeometry, playbackFollowScroll, selectProjectClips, parseClipClipboard, planAudioSlip, planAudioTrim, snapAudioEventStart, planZeroCrossingSplits, refineZeroCrossingTrims, planZeroCrossingBoundarySplits, repeatedSplitTicks, planAudioStretchResize … (+7) |
| elapsed-time.mjs | 71 | 119 | timeInteger, timeFields, timeRatio, timeString, secondsForUnits, unitsForSeconds, formatClockMilliseconds, parseClockMilliseconds |
| exact-tempo.mjs | 126 | 272 | EXACT_TEMPO_LIMITS, compileExactTempoMap |
| export-presets.mjs | 20 | 616 | exportPresetOptionsSchema, exportPresetSchema, resolveExportPresetOptions |
| formatted-time-command.mjs | 45 | 276 | resolveFormattedTimeCommand |
| midi-chase.mjs | 195 | 218 | MAX_CHASE_OPERATIONS, defaultChaseOptions, chaseOptionsSchema, resolveChaseOptions, chaseMidiStreams |
| midi-controllers-query.mjs | 29 | 308 | noteControllerSelection |
| midi-curves.mjs | 290 | 341 | MAX_CURVE_EVALUATIONS, MAX_MATERIALIZED_EVENTS, controllerCurveSchema, controllerLane, controllerValue, withControllerValue, evaluateCurve, validateMidiCurves, materializeMidiCurves, splitMidiCurves, rebaseMidiCurves, setMidiControllerValues … (+2) |
| midi-display-time.mjs | 25 | 152 | DEFAULT_MIDI_DISPLAY_PPQ, midiTickFraction, convertMidiTicks |
| midi-export-options.mjs | 12 | 396 | prepareMidiExportProject |
| midi-export-range.mjs | 19 | 484 | projectMidiExportRange |
| midi-import-channels.mjs | 8 | 276 | splitImportedMidiChannels |
| midi-import-inspector.mjs | 14 | 220 | extractMidiInspector |
| midi-import-single-part.mjs | 12 | 292 | mergeImportedMidiTracks |
| midi-input-filter.mjs | 8 | 288 | MIDI_INPUT_TYPES, midiInputFilterSchema, allowsMidiInput |
| midi-length-adjustment.mjs | 83 | 292 | resolveLengthAdjustment, adjustMidiNoteLengths, adjustMidiStreamLengths, defaultMidiTimingOptions, resolveMidiTimingOptions |
| midi-modifiers.mjs | 89 | 345 | modifierSchema, trackParameterSchema, partModifierSchema, defaultModifiers, defaultTrackParameters, defaultPartModifiers, validateModifierState, modifierTrackIds, applyMidiOutputModifiers |
| midi-playback.mjs | 235 | 252 | MIDI_RELEASE_SECONDS, MAX_MIDI_STATE_OPERATIONS, MAX_MIDI_SEGMENT_VISITS, needsMidiPlayback, midiPlaybackWarnings, compileMidiPlayback, midiPlaybackSampleCount, renderMidiPlayback |
| midi-recording.mjs | 39 | 482 | compileMidiTake |
| midi-split-options.mjs | 6 | 299 | defaultMidiSplitOptions, resolveMidiSplitOptions |
| midi-stream.mjs | 152 | 510 | compileMidiStreams, mergeMidiStreams |
| midi.mjs | 285 | 690 | parseMidi, writeMidi, writeMidiDetailed |
| mix-output.mjs | 16 | 305 | prepareMixOutput |
| musical-time.mjs | 126 | 125 | compileMusicalTime |
| note-audition.mjs | 25 | 576 | planNoteAudition |
| note-paint.mjs | 54 | 419 | compileNotePaint, planNotePaint |
| note-shapes.mjs | 28 | 246 | planNoteShape |
| note-time-insertion.mjs | 21 | 187 | planNoteTimeInsertion |
| output-resample.mjs | 34 | 345 | resampledBounds, resampleMixOutput |
| pan-law.mjs | 10 | 366 | PAN_LAW_DB, resolvePanLaw, panGains, monoSumGain |
| paste-time-plan.mjs | 16 | 474 | planPasteTimeClips |
| pedal-note-length.mjs | 22 | 287 | planPedalNoteLengths |
| pointer-time-grid.mjs | 87 | 322 | compilePointerTimeGrid |
| render-limits.mjs | 5 | 79 | MAX_RENDER_SECONDS, MAX_RENDER_SAMPLE_RATE, MAX_RENDER_SOURCE_SAMPLES |
| render-note-audition.mjs | 25 | 429 | renderNoteAudition |
| render-tracks.mjs | 31 | 221 | selectRenderTracks, selectRenderClips, bypassRenderEffects |
| render.mjs | 286 | 853 | projectDurationSeconds, renderProject |
| repeat-midi-loop.mjs | 19 | 300 | planRepeatMidiLoop |
| ruler-intervals.mjs | 62 | 192 | compileRulerIntervals |
| snap-grid.mjs | 59 | 443 | SNAP_GRID_FIELDS, snapGridSchema, snapGridPatchSchema, resolveSnapGrid, patchSnapGrid, compileEditorSnap |
| stem-plan.mjs | 44 | 813 | MAX_STEM_ZIP_BYTES, planStemExport, stemManifest |
| step-settings.mjs | 6 | 318 | stepSettingFields, stepSettingsSchema, resolveStepSettings |
| step-timing.mjs | 43 | 231 | resolveStepTiming, moveStepCursor, resizeHeldStep |
| stretch-clip.mjs | 12 | 561 | stretchAudioClip |
| tap-tempo.mjs | 24 | 275 | TAP_TEMPO_MODES, planTapTempo |
| tempo-from-audio.mjs | 13 | 425 | planTempoFromAudio |
| time-display.mjs | 97 | 175 | TIME_FORMATS, TIME_FORMAT_LABELS, timeDisplaySchema, defaultTimeDisplay, resolveTimeDisplay, compileProjectTimeDisplay |
| time-edit-resolver.mjs | 65 | 299 | ELAPSED_GRID_TYPES, compileTimeEditResolver |
| time-stretch.mjs | 24 | 489 | tempoFilterChain, timeStretchAudio |
| time.mjs | 57 | 101 | compileTempoMap, tickToSeconds, secondsToTick |
| timecode.mjs | 61 | 131 | TIMECODE_SUBFRAMES, compileTimecode |
| timeline-projection.mjs | 55 | 121 | compileTimelineProjection |
| track-audibility.mjs | 8 | 136 | audibleTrackIds |
| track-delay.mjs | 31 | 701 | resolveTrackDelay, processTrackDelay, estimateTrackDelayTail |
| track-effects.mjs | 5 | 206 | estimateTrackEffectsTail |
| track-eq.mjs | 82 | 538 | resolveTrackEq, activeEqBands, eqBandCoefficients, estimateTrackEqTail, processTrackEq, trackEqResponse, eqGraphDrag, parseEqFrequency, invertTrackEqGains, eqGraphGesture, preFilterSections, processBiquad … (+3) |
| track-pre.mjs | 7 | 147 | trackPreGain |
| transpose-plan.mjs | 21 | 429 | TRANSPOSE_SCALES, planTranspose |
| wav.mjs | 110 | 244 | decodeWav, encodeWav |
| zero-crossing.mjs | 20 | 500 | findAudioZeroCrossing |

## src/

Server, CLI, persistence, workspace/documents, workers (top-level files only).

| file | lines | max line | exports |
|---|---:|---:|---|
| audio-statistics-worker.mjs | 5 | 120 |  |
| auto-backup.mjs | 204 | 276 | backupBaseName, validateBackupRegistry, listBackups, readBackup, createAutoBackup |
| chase-settings.mjs | 127 | 523 | defaultChaseSettings, getChaseSettings, updateChaseSettings, withChaseDefaults |
| cli.mjs | 640 | 1833 | main |
| controller-settings.mjs | 168 | 380 | defaultControllerSettings, getControllerSettings, updateControllerSettings, withControllerDefaults |
| demo.mjs | 44 | 277 | createDemoProject |
| document-session.mjs | 140 | 687 | createDocumentSession |
| folder-browser.mjs | 33 | 212 | browseProjectFolders |
| media-resolution.mjs | 140 | 302 | createMediaResolver |
| media-search.mjs | 242 | 312 | MEDIA_SEARCH_LIMITS, createMediaSearch, readMediaCandidate |
| native-audio.mjs | 79 | 316 | createNativeAudio |
| native-midi-settings.mjs | 128 | 503 | defaultNativeMidiSettings, defaultNativeMidiProject, getNativeMidiSettings, updateNativeMidiSettings |
| native-transport.mjs | 103 | 353 | createNativeTransport |
| note-audition-jobs.mjs | 27 | 264 | createNoteAuditionJobs |
| note-audition-worker.mjs | 8 | 171 |  |
| project-drafts.mjs | 298 | 337 | previewDraft, createDraft, listDrafts, inspectDraft, prepareDraft, beginDraftPublication, finalizeDraftPublication, abortDraftPublication, validateProjectFolderPath |
| project-files.mjs | 363 | 372 | MAX_BUNDLE_BYTES, readVerifiedAsset, readVerifiedSourceArchive, restoreSourceArchive, restoreAsset, assetInventory, collectProject, recoverProject, storedZip, createProjectBundle, recoverAutoBackup |
| project-locations.mjs | 187 | 294 | DEFAULT_PROJECT_LOCATION_SETTINGS, getProjectLocationSettings, updateProjectLocationSettings, withProjectLocationSettings, inspectProjectFolder, validateProjectFolderName, resolveProjectLocation |
| project-open.mjs | 181 | 310 | inspectExistingProject, prepareExistingProject |
| project-save.mjs | 238 | 287 | MAX_SAVED_CHECKPOINT_BYTES, contentProjectHash, loadSavedCheckpoint, saveExplicitCheckpoint, previewProjectVersion, prepareProjectVersion |
| recent-projects.mjs | 220 | 279 | MAX_RECENT_PROJECTS, listRecentProjects, recordRecentProject, removeRecentProject, clearRecentProjects |
| render-worker.mjs | 59 | 337 | renderSnapshotData |
| reset-settings.mjs | 120 | 523 | defaultResetOptions, resolveResetOptions, defaultResetSettings, getResetSettings, updateResetSettings |
| revert-media.mjs | 387 | 390 | registerCreatedMedia, captureMediaOwnership, planRevertMedia, applyRevertMediaPlan, listRevertMediaTrash, restoreRevertMediaTrash |
| server.mjs | 958 | 3580 | CAPABILITIES, startServer |
| session-store.mjs | 212 | 207 | MAX_JOURNAL_BYTES, DEFAULT_SESSION_SETTINGS, canonicalProjectHash, validateSessionSettings, assertSidecarLocation, readSidecar, writeSidecar, quarantineSidecar, loadSessionState, commitSessionState, updateSessionSettings |
| split-settings.mjs | 132 | 523 | defaultSplitSettings, getSplitSettings, updateSplitSettings, withSplitDefaults |
| stem-directory.mjs | 26 | 277 | renderStemDirectory |
| stem-worker.mjs | 22 | 433 | renderStemBundle, MAX_STEM_ZIP_BYTES |
| storage.mjs | 85 | 187 | atomicWrite, createDirectoryAtomically, saveProject, acquireProjectLock |
| time-stretch-batch.mjs | 10 | 1276 | prepareTimeStretchBatch |
| timing-settings.mjs | 119 | 525 | defaultTimingSettings, getTimingSettings, updateTimingSettings |
| workspace.mjs | 311 | 594 | createWorkspace |

## public/

Browser GUI (no framework). app.mjs owns state/rendering; other files are feature modules wired from app.mjs.

| file | lines | max line | exports |
|---|---:|---:|---|
| app.mjs | 2299 | 7381 |  |
| audio-scrub.mjs | 22 | 565 | scrubMotion, createBufferScrubber |
| chase-settings.mjs | 15 | 911 | chaseLabels, readChaseProfile, setupChaseSettings |
| controller-lanes.mjs | 267 | 6763 | setupControllerLanes |
| controller-settings.mjs | 102 | 346 | controllerProfile, subscribeControllerSettings, refreshControllerSettings, fillControllerMenu, openControllerSettings |
| document.mjs | 76 | 782 | setupDocumentUI |
| editing.mjs | 444 | 1406 | setupEditingUI, planTrackMix, planTrackStep, planTrackDrop, planMidiPartCommands |
| i18n.mjs | 71 | 368 | applyLanguage, setupI18n |
| inspector-time.mjs | 102 | 473 | setupInspectorTime |
| metronome.mjs | 25 | 461 | setupMetronome |
| microphone-recorder.mjs | 27 | 1772 | recordingBlockWindow, createMicrophoneRecorder |
| midi-events.mjs | 105 | 2067 | setupMidiEventsUI |
| midi-merge.mjs | 19 | 2002 | setupMidiMerge |
| midi-modifiers.mjs | 45 | 939 | setupMidiModifiers |
| musical-time-display.mjs | 70 | 440 | setupMusicalTimeDisplay |
| native-audio.mjs | 27 | 506 | setupNativeAudio |
| native-midi.mjs | 69 | 1091 | setupNativeMidi |
| note-audition-browser.mjs | 36 | 193 | createBrowserNoteAudition |
| note-audition-targets.mjs | 11 | 145 | noteAuditionTargets |
| note-audition.mjs | 27 | 108 | createNoteAudition |
| note-clipboard.mjs | 17 | 345 | prepareNotePaste, captureNoteClipboard |
| note-keyboard-selection.mjs | 28 | 393 | navigateNoteSelection, selectNotePitch, selectNoteMenu |
| note-velocity-readout.mjs | 15 | 210 | buildNoteVelocityReadout, queryNoteVelocityReadout |
| projects.mjs | 281 | 2060 | setupProjectsUI |
| recording-ui.mjs | 15 | 2028 | setupRecording |
| reset-settings.mjs | 16 | 1090 | resetLabels, readResetProfile, setupResetSettings |
| resolution.mjs | 105 | 892 | setupResolutionUI |
| session.mjs | 84 | 774 | setupSessionUI |
| snap-grid-settings.mjs | 18 | 931 | setupSnapGridSettings |
| tap-tempo-ui.mjs | 21 | 904 | setupTapTempo |
| time-display-settings.mjs | 32 | 1866 | setupTimeDisplaySettings |
| timing-settings.mjs | 18 | 1782 | readTimingProfile, setupTimingSettings |
| web-midi-input.mjs | 205 | 1982 | setupBrowserMidiInput, setupBrowserMidiRecording, createMidiTakeStore, createMidiMonitorChannel, midiMonitorVoiceHeld, midiMonitorPitch, applyMidiMonitorCC |

## scripts/

Build/check tools and gui-*-smoke.mjs browser tests (top-level files only).

| file | lines | max line | exports |
|---|---:|---:|---|
| build-native-audio-units.mjs | 16 | 248 |  |
| build-native-audio.mjs | 16 | 249 |  |
| build-native-midi.mjs | 16 | 248 |  |
| check.mjs | 9 | 208 |  |
| gui-auto-backup-recovery-smoke.mjs | 64 | 213 |  |
| gui-chase-settings-smoke.mjs | 46 | 1165 |  |
| gui-controller-bend-smoke.mjs | 59 | 1166 |  |
| gui-controller-fidelity-smoke.mjs | 85 | 1603 |  |
| gui-controller-lanes-smoke.mjs | 106 | 1331 |  |
| gui-controller-paint-smoke.mjs | 58 | 893 |  |
| gui-controller-settings-smoke.mjs | 54 | 1170 |  |
| gui-controller-shapes-smoke.mjs | 62 | 856 |  |
| gui-controller-snap-smoke.mjs | 46 | 742 |  |
| gui-controller-time-smoke.mjs | 64 | 1166 |  |
| gui-document-smoke.mjs | 195 | 1414 |  |
| gui-drafts-smoke.mjs | 139 | 1393 |  |
| gui-editing-smoke.mjs | 77 | 1399 |  |
| gui-editor-geometry-smoke.mjs | 78 | 624 |  |
| gui-event-time-smoke.mjs | 42 | 1006 |  |
| gui-first-delivery-smoke.mjs | 342 | 388 |  |
| gui-formatted-time-smoke.mjs | 42 | 867 |  |
| gui-inspector-time-smoke.mjs | 45 | 1306 |  |
| gui-locations-smoke.mjs | 108 | 1393 |  |
| gui-midi-chase-smoke.mjs | 39 | 1161 |  |
| gui-midi-events-smoke.mjs | 88 | 831 |  |
| gui-midi-merge-smoke.mjs | 40 | 1161 |  |
| gui-midi-modifiers-smoke.mjs | 54 | 1165 |  |
| gui-midi-playback-smoke.mjs | 86 | 831 |  |
| gui-musical-time-smoke.mjs | 45 | 877 |  |
| gui-native-audio-smoke.mjs | 37 | 595 |  |
| gui-native-midi-smoke.mjs | 48 | 848 |  |
| gui-new-project-delivery-smoke.mjs | 78 | 211 |  |
| gui-note-arrow-smoke.mjs | 37 | 1211 |  |
| gui-note-audition-form-smoke.mjs | 54 | 616 |  |
| gui-note-audition-races-smoke.mjs | 57 | 616 |  |
| gui-note-audition-release-smoke.mjs | 57 | 1128 |  |
| gui-note-audition-shapes-smoke.mjs | 53 | 527 |  |
| gui-note-audition-smoke.mjs | 45 | 508 |  |
| gui-note-audition-worker-smoke.mjs | 54 | 616 |  |
| gui-note-clipboard-smoke.mjs | 42 | 1045 |  |
| gui-note-crossclip-smoke.mjs | 41 | 665 |  |
| gui-note-cut-paste-smoke.mjs | 42 | 1045 |  |
| gui-note-keyboard-clipboard-smoke.mjs | 41 | 1009 |  |
| gui-note-locators-numeric-smoke.mjs | 37 | 2871 |  |
| gui-note-locators-race-smoke.mjs | 37 | 4482 |  |
| gui-note-locators-smoke.mjs | 37 | 1849 |  |
| gui-note-object-smoke.mjs | 65 | 875 |  |
| gui-note-paint-smoke.mjs | 65 | 874 |  |
| gui-note-pitch-selection-smoke.mjs | 37 | 1805 |  |
| gui-note-repeat-smoke.mjs | 42 | 508 |  |
| gui-note-selection-menu-smoke.mjs | 37 | 2767 |  |
| gui-note-shapes-smoke.mjs | 60 | 886 |  |
| gui-note-velocity-cursor-smoke.mjs | 42 | 470 |  |
| gui-paste-time-smoke.mjs | 42 | 621 |  |
| gui-projects-smoke.mjs | 195 | 1414 |  |
| gui-recording-assistance-smoke.mjs | 66 | 347 |  |
| gui-recording-protection-smoke.mjs | 41 | 2159 |  |
| gui-recording-workflow-smoke.mjs | 41 | 1087 |  |
| gui-recovery-smoke.mjs | 96 | 1400 |  |
| gui-reset-smoke.mjs | 54 | 894 |  |
| gui-resolution-smoke.mjs | 91 | 1394 |  |
| gui-ruler-intervals-smoke.mjs | 40 | 991 |  |
| gui-session-smoke.mjs | 53 | 1391 |  |
| gui-smoke.mjs | 40 | 312 |  |
| gui-snap-grid-smoke.mjs | 42 | 825 |  |
| gui-split-controller-policy-smoke.mjs | 38 | 2146 |  |
| gui-split-note-policy-smoke.mjs | 38 | 1861 |  |
| gui-split-settings-race-smoke.mjs | 38 | 4907 |  |
| gui-split-settings-smoke.mjs | 38 | 3630 |  |
| gui-time-display-smoke.mjs | 44 | 698 |  |
| gui-timing-smoke.mjs | 51 | 1036 |  |
| gui-workspace-smoke.mjs | 211 | 1415 |  |

## scripts/agent/

Agent harness (verify, checkpoint, find, show, guard, e2e, task, map).

| file | lines | max line | exports |
|---|---:|---:|---|
| checkpoint.mjs | 73 | 201 |  |
| e2e.mjs | 35 | 188 |  |
| find.mjs | 35 | 156 |  |
| guard.mjs | 82 | 244 |  |
| lib.mjs | 99 | 237 | ROOT, AGENT_DIR, CHECKPOINT_DIR, TRACKED, PROTECTED, sha256, rel, walk, hashTree, diffMaps, readJson, writeJson … (+7) |
| map.mjs | 44 | 346 |  |
| show.mjs | 31 | 146 |  |
| smoke-sweep.mjs | 38 | 184 |  |
| task.mjs | 60 | 263 |  |
| verify.mjs | 78 | 298 |  |

## Engine commands (144)

Defined in `src/core/schema.mjs` (`definitions` array → name, description, argument schema) and applied in `src/core/engine.mjs` (`applyCommand` switch). CLI: `node src/cli.mjs command NAME JSON`; live schemas: `node src/cli.mjs commands`.

| command | description |
|---|---|
| `arrangement.reorder` | Move a track or folder before a sibling, or null for last. Parent and media remain unchanged; order is saved per item. |
| `asset.add` | Register server-created content-addressed WAV metadata. Does not read or write files. |
| `asset.relink` | Replace verified content-addressed WAV metadata for existing asset IDs, preserving their names and all clip references, timeline positions a… |
| `asset.removeMissing` | Remove verified missing asset registrations and every audio clip referencing them, preserving tracks, MIDI clips and other assets. Trusted c… |
| `audio.clip.applyTimeStretch` | Replace an event with a verified registered processed asset. Event processing was baked externally and is reset; preserve name/track/mute, m… |
| `audio.clip.envelope` | Replace the nondestructive event volume envelope. Points use absolute source-window frame coordinates and linear amplitude gain 0..4; empty … |
| `audio.clip.resizeContents` | Resize while moving content: left edge keeps source offset and moves project start; right edge keeps source endpoint and moves source offset… |
| `audio.clip.restoreProcessing` | Restore an audio processing source snapshot, preserving current event identity, track, name, start and mute. Source asset must already exist… |
| `audio.clip.selectTake` | Select an unmuted audio event for front playback: enable front mode on its track and raise its priority atomically. Timing/media/mute flags … |
| `audio.clip.slip` | Shift the source window by signed source frames without moving or resizing the audio clip. Shift fade and reverse source windows together; r… |
| `audio.clip.snapToCursor` | Set an event-specific source snap point from an absolute project sample inside its current trim. Does not change audio or the asset template… |
| `audio.clip.tempoFromEvent` | Set tempo from audio-event trimmed duration and Locator beat count. Left locator must match event start within one project sample. Scope pro… |
| `audio.clip.toFront` | Raise an audio clip above other clips on its track without changing timing or media. |
| `audio.clip.trim` | Nondestructive edge trim by signed source-frame delta. Left positive removes head, right positive extends tail. Left rounds to nearest commo… |
| `audio.clips.crossfade` | Apply linear or equal-power fades over the full overlap of two ordered audio clips on the same track. Keep source files and clip positions u… |
| `audio.clips.fades` | Set fade lengths in milliseconds on selected audio clips, converting with each asset sample rate. At least one length is required; explicit … |
| `audio.clips.fadesToRange` | Set event fades from an absolute project sample range. in: event start to range start, or range end if range starts at/before event. out: ra… |
| `audio.clips.glue` | Rejoin contiguous same-source audio fragments on one track without writing media. Requires identical effective gain/mute/polarity/reverse/fa… |
| `audio.clips.glueNext` | Rejoin an audio fragment with the next event on its track, or all following events. All fragments must satisfy audio.clips.glue continuity a… |
| `audio.clips.removeFades` | Remove fade-in, fade-out or both on selected audio clips without changing gain, volume envelope, source or positions. |
| `audio.clips.silence` | Add or clear nondestructive silence in selected audio clip trims, optionally restricted to a project sample range. Range overlap rounds outw… |
| `batch` | Apply commands atomically as one undo step and one revision. No nested batch or history command. |
| `clip.add` | Create a clip. MIDI defaults to tick 0, length 3840 and no notes. Audio positions are explicit. |
| `clip.copyTo` | Create an independent clip copy at an arbitrary absolute destination, including earlier positions. Preserve source media attributes/MIDI eve… |
| `clip.duplicate` | Create 1..64 independent copies after the source. count defaults 1; spacing is start-to-start in ticks for MIDI or project samples for audio… |
| `clip.move` | Move one clip to a compatible track and/or absolute position. MIDI accepts startTick; audio accepts startSample. At least one destination fi… |
| `clip.remove` | Remove a clip and its notes, preserving its track and asset. |
| `clip.split` | Split strictly inside a clip using absolute atTick (MIDI) or atSample (audio). Left clip ID remains. Right-only note/event IDs move intact, … |
| `clip.update` | Update a clip by ID; fields must match its media type. Notes, raw MIDI events and audio trim must remain within bounds; shortening never sil… |
| `clips.cutAt` | Cut head (before cursor) or tail (after cursor) of crossing clips only. Empty selection targets all crossing clips. Split rules, source asse… |
| `clips.fillLoop` | Copy selected clips as a group from the left locator up to the right locator; shorten final copies at the right boundary. Originals stay unc… |
| `clips.moveGroup` | Move selected clips as a group to atTick (musical) or atSample (elapsed); exactly one required. Earliest start is the anchor, relative posit… |
| `clips.moveToTrack` | Move selected clips onto one compatible existing track. Preserve positions and content; reject mixed types or any missing target atomically. |
| `clips.nudge` | Move selected clips by the primary grid, preserving offsets. Musical mode uses tick delta and an audio sample delta at the first clip anchor… |
| `clips.paste` | Paste frozen clip snapshots within the same project with fresh IDs. Track mapping uses original IDs or exact case-sensitive name/type; ambig… |
| `clips.repeat` | Repeat selected clips as a musical or elapsed-time group with independent copies. Default spacing is the outward-rounded selection span in t… |
| `clips.setMute` | Set mute on selected MIDI/audio clips atomically without changing track mute or source media. |
| `clips.splitAt` | Split clips crossing an absolute musical cursor tick. Omitted/empty clipIds targets all crossing clips; otherwise only selected IDs. Audio u… |
| `clips.splitAtLocators` | Split targeted clips at both saved locators. Empty selection means all crossing clips; newly created right clips remain targeted for the sec… |
| `clips.splitRepeated` | Split at range start + N*intervalTicks, strictly before range end. Range defaults to saved locators. Up to 1024 boundaries, 4096 clip splits… |
| `folder.add` | Create a folder container and optionally move existing tracks into it. Folder visibility does not alter playback. |
| `folder.contents.move` | Move all clips in a folder and nested folders as one group to atTick or atSample (exactly one required). Preserves content/media/parents and… |
| `folder.fold` | Fold, unfold or independently flip selected folder states. deep:true includes descendant folders; tracks/media/playback flags unchanged. One… |
| `folder.move` | Move a folder under another folder or to root; cycles reject atomically. |
| `folder.remove` | Remove folder only and reparent children by default; deleteContents:true removes its descendant tracks/clips while retaining assets. One Und… |
| `folder.tracksState` | Set mute/solo on all descendant MIDI/audio tracks. exclusiveSolo:true with solo:true also clears solo on tracks outside the folder. Does not… |
| `folder.update` | Edit folder name, color or collapsed view state without altering child media. |
| `history.describe` | Edit the description of one retained entry. Empty text clears it. Increments project revision without adding a musical undo step or clearing… |
| `history.goTo` | Move atomically to one retained history boundary by zero-based index or stable boundaryId. Index 0 is the retained baseline; index N applies… |
| `history.redo` | Redo one undone mutation while incrementing revision. |
| `history.settings` | Set the retained history limit (1..1000, default 100). Prunes oldest applied entries first, then farthest redo entries if needed to preserve… |
| `history.undo` | Undo one mutation or atomic batch while incrementing revision. |
| `marker.add` | Create a position marker or cycle marker with endTick>tick. Human numbers are unique independently by marker type; omitted number allocates … |
| `marker.remove` | Remove one project marker. |
| `marker.renumber` | Assign chronological numbers independently to position/cycle markers, preserving stable object IDs. |
| `marker.update` | Edit name/tick/number and existing cycle endTick. Marker type is preserved. |
| `midi.clip.resizeStart` | Move the left part boundary by signed ticks, keeping its right boundary and absolute note/controller timing. Shift relative notes, quantize … |
| `midi.clips.glue` | Glue selected same-track MIDI parts into the earliest part, keeping note/event IDs and absolute timing. Editable curves retain their handles… |
| `midi.clips.glueNext` | Glue a MIDI part to the next part on the same track; allFollowing includes every later part. Same onset ties use project order. Same lossles… |
| `midi.controllers.bend` | Bend the visible midpoint of one active Ramp/Bezier controller segment by a signed MIDI value displacement. Endpoints and handle times remai… |
| `midi.controllers.curve` | Set outgoing Ramp/Bezier on selected numeric controller knots; null returns to Step. Raw point values remain unchanged. A final point withou… |
| `midi.controllers.delete` | Delete stored CC events only. mode all removes every CC; continuous preserves CC64..69 on/off and CC120..127 channel-mode messages. Notes, p… |
| `midi.controllers.draw` | Insert or replace exact controller knots. New points set the previous-to-new segment curve (default Step). Existing same-lane/same-time poin… |
| `midi.controllers.line` | Replace the inclusive lane interval with discrete straight-line points at stepTicks, always including both endpoints. This Line density is s… |
| `midi.controllers.move` | Move or copy numeric events atomically. Destination collisions replace the previous same-lane/same-time data. Optional targetLane preserves … |
| `midi.controllers.paint` | Replace an inclusive lane range with sampled Paint points. Explicit edge and outside guard events preserve known integer-tick state outside … |
| `midi.controllers.paste` | Paste relative clipboard controller points at atTick into a concrete lane. Same-lane/same-time destinations are replaced, preserving other e… |
| `midi.controllers.setValues` | Set absolute values of existing numeric controller IDs in one transaction. Never creates, removes, moves or reorders stored points. Affected… |
| `midi.controllers.shape` | Generate Parabola/Sine/Triangle/Square discrete controller points and replace the complete inclusive lane range as one edit. Period is music… |
| `midi.controllers.thin` | Thin ordinary CC lanes with held-value tolerance 0..127 (default0). Preserve run endpoints, simultaneous knots, curved and paired 14-bit lan… |
| `midi.events.add` | Add raw channel, F0/F7 SysEx or unmanaged meta messages relative to a MIDI clip. Missing IDs are generated; omitted order follows every expl… |
| `midi.events.remove` | Remove raw MIDI events by stable IDs. Every ID must exist and be listed once. Notes and other events are unchanged. |
| `midi.events.update` | Edit one raw event tick, data, source order or channel. Channel changes preserve the channel-status message type; kind/status/metaType remai… |
| `midi.mergeLoop` | Merge audible MIDI output beginning within [leftTick,rightTick) into a new part on the first selected MIDI track, or a new track. Note tails… |
| `midi.modifiers.freeze` | Bake current supported track/part modifiers, delay, setup messages and sampled curves into source events, resetting their settings. MIDI ins… |
| `midi.modifiers.set` | Set non-destructive track MIDI modifiers. Ratios replace as pairs; random/ranges each use two ordered slots. Seeded variations are repeatabl… |
| `midi.notes.add` | Add notes relative to a MIDI clip. Channel defaults to 0; all notes must fit the clip. |
| `midi.notes.deleteOverlaps` | Shorten selected overlapping notes to the next selected onset in each channel, optionally grouping by pitch. samePitch/allPitches are explic… |
| `midi.notes.freezeQuantize` | Replace selected notes quantize references with their current start/duration without changing audible note values. Subsequent original-basis… |
| `midi.notes.glue` | Glue each selected source note to the next strictly later note of identical pitch/channel in its part. The next note need not be selected. P… |
| `midi.notes.inputValues` | Apply received MIDI pitch/on-off velocity to one selected note/chord. Optional add or replace chord; preserve timing/channel and return next… |
| `midi.notes.legato` | Extend selected notes to the next strictly later onset in the same channel. betweenSelectedOnly defaults true; false also considers unselect… |
| `midi.notes.length` | Set/add ticks or multiply selected note durations, preserving onsets. Round nearest integer, minimum 1 tick; negative scale is invalid. Over… |
| `midi.notes.move` | Move/copy selected notes and optionally related controller ranges as one undo step. Delta ticks/pitch apply to the selected notes; note timi… |
| `midi.notes.paint` | Draw a continuous path over existing note velocity or releaseVelocity values. Fractional source ticks and values interpolate in the saved be… |
| `midi.notes.pasteTime` | Insert explicit clipboard notes into the selected MIDI clip, splitting crossing notes and preserving editable controller fragments as indepe… |
| `midi.notes.pedalsToLength` | Extend selected note lengths through sustain release, then remove every stored CC64 event in this part. Other controller types remain. Part-… |
| `midi.notes.quantize` | Quantize on a clip-relative grid. basis defaults current for compatibility (iterative); original recalculates from a saved timing reference.… |
| `midi.notes.remove` | Remove the listed notes; every ID must exist and be listed once. |
| `midi.notes.removeDoubles` | Remove notes with identical pitch, relative start and channel. Keep the first in stored note order, including its duration/velocity/ID. Diff… |
| `midi.notes.repeat` | Duplicate selected notes as a unit immediately after their original selection span. count is the number of additional copies (default1, max6… |
| `midi.notes.resetQuantize` | Restore selected notes start/duration from their quantize reference, preserving pitch/velocity/channel. Missing or invalidated references ar… |
| `midi.notes.restrictPolyphony` | Shorten oldest active selected notes when a new selected note would exceed voices (1..128). Shared across channels unless perChannel true. S… |
| `midi.notes.reverse` | Reverse selected note onsets or mirror full note boundaries, preserving IDs, pitch, velocity, release data and duration. reverse reflects ar… |
| `midi.notes.shape` | Edit existing note velocity or releaseVelocity at exact original onset ticks using Line/Parabola/Sine/Triangle/Square. No new events, densit… |
| `midi.notes.split` | Split selected notes at unique part-relative tick boundaries. Strict interior crossings only; first fragment keeps note ID/on order, last ke… |
| `midi.notes.transpose` | Transpose selected notes by integer semitones. Omitted noteIds means all; [] means none. Without pitchRange reject any result outside 0..127… |
| `midi.notes.update` | Update one note by stable clip and note IDs, including release velocity, note-off encoding and explicit source order. Actual manual start/du… |
| `midi.notes.velocity` | Set/add/scale or limit velocity (default) or releaseVelocity. set/add/scale require finite value; scale nonnegative (1=100%). Round then cla… |
| `midi.part.repeatLoop` | Repeat a part-relative half-open source interval to part end, replacing notes/events whose onsets are at or after endTick. Preserve source n… |
| `midi.partModifiers.set` | Set playback-only part transpose/velocity offsets, without changing editor notes. |
| `midi.parts.dissolve` | Copy selected MIDI parts to new tracks by channel or pitch, grouped per source track; mute originals with copied content. Fresh object IDs, … |
| `midi.pitchBendGrid.set` | Set track-saved pitchbend lane display/grid. Up/down 1..96 semitones, linked ranges must agree. Does not change raw MIDI values, RPN instrum… |
| `midi.record.take` | Commit a timestamped channel-message take as a new clip merge into targetClipId, or replace the recording interval on an explicit MIDI track… |
| `midi.step` | Insert one editable chord or rest and return the next step position. Step ticks and duration are independent; optional stepSource/lengthSour… |
| `midi.trackParameters.set` | Set output-stage delay in milliseconds and optional channel-specific bank/program/CC7/CC10 setup. Null disables a setup message; audio mixer… |
| `project.cycle` | Enable/disable locator cycle playback intent. |
| `project.effectPreset.put` | Save/update project Pre/EQ/delay preset; at least one effect required. null stores reset. Names are case-insensitively unique, max64. |
| `project.effectPreset.remove` | Delete one project effect preset, leaving current track effects untouched. |
| `project.effectPreset.rename` | Rename saved effect preset without changing its settings. |
| `project.exportPreset.put` | Create or replace one project-scoped WAV format preset by ID. Names are case-insensitively unique. No output path, target tracks or ranges s… |
| `project.exportPreset.remove` | Remove one project-scoped export preset. |
| `project.locators` | Set project musical locator range, or clear it with null. This range does not enable cycle playback. |
| `project.locatorsFromClips` | Set locators around selected MIDI/audio clips. Audio bounds round outward to source ticks. Optionally enable cycle in the same Undo operatio… |
| `project.locatorsMove` | Move both locators by signed source ticks, preserving duration and cycle state. |
| `project.locatorsResize` | Set positive locator duration, keeping the left or right boundary fixed. |
| `project.midiInputFilter` | Set project-scoped MIDI input filter defaults for monitor and take commits; null restores all channel-message types. Explicit take inputFilt… |
| `project.midiStepSettings` | Set project-scoped step-input defaults, independently of note content. null restores PPQ-based defaults. |
| `project.rename` | Rename the project. |
| `project.settings` | Update master gain and pan law. legacy preserves old mono export average; equalPower uses constant-power mono pan and -3.01dB stereo sum, 0d… |
| `project.snapGrid` | Update saved primary/project and piano snap grids without changing stored notes or audio. |
| `project.timeDisplay` | Update project primary/ruler time formats and frame display. Stored MIDI/audio positions remain unchanged. |
| `project.trackTimeBase` | Set default time base for newly added tracks; Follow Transport uses primary Bars+Beats for Musical and other formats for Linear. null restor… |
| `signature.set` | Replace fixed project time signature; MIDI ticks and audio samples stay unchanged. No signature map. |
| `sourceArchive.add` | Register an immutable original source container independently of the canonical playback WAV. Original metadata is preserved as bytes; no pla… |
| `tempo.change` | Change fixed global BPM, or set a tempo point at atTick in Track mode. A map without changes updates its initial point. |
| `tempo.mode` | Enable tempo track, or use a fixed global tempo while retaining the inactive map. Switching back restores the stored map. Optional bpm only … |
| `tempo.set` | Replace the step tempo map; first tick must be zero and ticks strictly increase. |
| `track.add` | Create a MIDI or audio track. MIDI defaults to the sine instrument; omitted IDs are generated. |
| `track.audioOverlap` | Choose audio overlap policy: mix (legacy sum) or front (highest frontOrder, ties later clip-array order). Muted clips reveal lower clips. |
| `track.audioTimeBase` | Set an audio track to musical (start positions follow tempo) or linear (absolute sample positions). Audio length/source are unchanged. MIDI … |
| `track.duplicate` | Copy current track settings immediately below the source. includeClips defaults true; copied clips, notes and raw MIDI events get fresh IDs,… |
| `track.eqFrequency` | Set one configured EQ band frequency from Hz or note+optional cents. EQ convention A3=440Hz; bandIndex0..3. |
| `track.midiTimeBase` | Set MIDI track time base. Musical retains ticks; linear remaps note on/off and raw event ticks to retain absolute seconds on tempo changes. … |
| `track.remove` | Remove a track and its clips, preserving media assets. |
| `track.reorder` | Move one track to its final zero-based index (0..track count-1), preserving all object IDs. |
| `track.soloExclusive` | Enable solo on one track and clear solo on all others, preserving all mute states. |
| `track.update` | Update a track by stable ID. Instrument is valid only for MIDI tracks. Optional renameClips requires name: matching changes only clips whose… |
| `tracks.clearMuteSolo` | Clear mute, solo, or both on every track. No gain/pan changes. |
| `tracks.effectPreset.apply` | Apply a project effect preset to selected tracks. Scope all/pre/eq/delay; absent effect keys remain untouched. |
| `tracks.effectsApply` | Apply full saved Pre/EQ/delay settings to selected tracks atomically; null removes that effect. At least one effect required. Track mixer/in… |
| `tracks.eqInvert` | Invert saved gain-bearing EQ bands on selected tracks. Disabled bands are included; pass/notch and all unrelated settings remain unchanged. |
| `tracks.moveToFolder` | Move existing tracks into a folder or root, preserving clips and track settings. |
| `tracks.removeEmpty` | Remove tracks with no clips. A MIDI part with no notes still makes a track nonempty. Media assets are retained. |
