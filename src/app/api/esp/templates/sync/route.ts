import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { resolveAdapterAndCredentials, isResolveError } from '@/lib/esp/route-helpers';
import { unsupportedCapabilityPayload } from '@/lib/esp/unsupported';
import { prisma } from '@/lib/prisma';
import {
  readEspTemplateFolderStore,
  writeEspTemplateFolderStore,
  findFolderByRemoteId,
  createAccountFolder,
  assignTemplatesToFolder,
} from '@/lib/esp-template-folders-store';
import { fetchTemplateFolders } from '@/lib/esp/adapters/ghl/templates';

/**
 * POST /api/esp/templates/sync?accountKey=xxx
 *
 * Pull latest templates from the ESP and upsert into local EspTemplate table.
 * Also syncs GHL template folders into local folder store.
 * Returns a sync summary.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const accountKey = req.nextUrl.searchParams.get('accountKey');
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }

  const userRole = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];
  const hasUnrestrictedAdminAccess = userRole === 'admin' && userAccountKeys.length === 0;
  if (userRole !== 'developer' && !hasUnrestrictedAdminAccess && !userAccountKeys.includes(accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const result = await resolveAdapterAndCredentials(accountKey, {
    requireCapability: 'templates',
  });
  if (isResolveError(result)) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { adapter, credentials } = result;
  if (!adapter.templates) {
    return NextResponse.json(
      unsupportedCapabilityPayload(adapter.provider, 'templates'),
      { status: 501 },
    );
  }

  try {
    // Fetch all templates from ESP
    const remoteTemplates = await adapter.templates.fetchTemplates(
      credentials.token,
      credentials.locationId,
    );

    // ── Sync GHL folders ──
    // Fetch remote folders and upsert into local folder store.
    // Map GHL remoteId → local folderId so we can assign templates to folders.
    const remoteFolderIdToLocalId = new Map<string, string>();
    let foldersSynced = 0;

    if (adapter.provider === 'ghl') {
      try {
        const remoteFolders = await fetchTemplateFolders(
          credentials.token,
          credentials.locationId,
          { forceRefresh: true },
        );
        console.log(`[sync] GHL folders found for ${accountKey}: ${remoteFolders.length}`, remoteFolders.map(f => ({ id: f.id, name: f.name })));

        if (remoteFolders.length > 0) {
          const store = readEspTemplateFolderStore();

          for (const remoteFolder of remoteFolders) {
            if (!remoteFolder.id) continue;

            const existing = findFolderByRemoteId(store, accountKey, remoteFolder.id);
            if (existing) {
              // Update name if changed
              if (existing.name !== remoteFolder.name) {
                existing.name = remoteFolder.name;
                existing.updatedAt = new Date().toISOString();
              }
              remoteFolderIdToLocalId.set(remoteFolder.id, existing.id);
            } else {
              // Create local folder matching the remote one
              const localFolder = createAccountFolder(
                store,
                accountKey,
                remoteFolder.name,
                null, // parentId resolved in second pass
                remoteFolder.id,
              );
              remoteFolderIdToLocalId.set(remoteFolder.id, localFolder.id);
              foldersSynced++;
            }
          }

          // Second pass: resolve parent folder IDs (remote → local)
          for (const remoteFolder of remoteFolders) {
            if (!remoteFolder.parentId) continue;
            const localId = remoteFolderIdToLocalId.get(remoteFolder.id);
            const localParentId = remoteFolderIdToLocalId.get(remoteFolder.parentId);
            if (localId && localParentId) {
              const localFolder = store.folders.find(
                (f) => f.id === localId && f.accountKey === accountKey,
              );
              if (localFolder) {
                localFolder.parentId = localParentId;
              }
            }
          }

          writeEspTemplateFolderStore(store);
        }
      } catch (folderErr) {
        // Non-fatal: folder sync failure shouldn't block template sync
        console.error('[sync] Failed to sync GHL folders:', folderErr);
      }
    }

    // ── Clean up folders that were previously synced as templates ──
    const folderRemoteIds = Array.from(remoteFolderIdToLocalId.keys());
    console.log(`[sync] Folder remote IDs to clean up for ${accountKey}:`, folderRemoteIds);
    let foldersDeleted = 0;
    if (folderRemoteIds.length > 0) {
      const deleteResult = await prisma.espTemplate.deleteMany({
        where: {
          accountKey,
          provider: adapter.provider,
          remoteId: { in: folderRemoteIds },
        },
      });
      foldersDeleted = deleteResult.count;
      console.log(`[sync] Deleted ${foldersDeleted} folder-as-template records for ${accountKey}`);
    }

    // ── Sync templates ──

    // Back-compat: templates published via `publishedTo` may not have legacy `remoteId` populated.
    // Build a lookup so sync updates those rows instead of creating duplicates.
    const publishedCandidates = await prisma.espTemplate.findMany({
      where: {
        accountKey,
        provider: adapter.provider,
        publishedTo: { not: null },
      },
    });
    const publishedLookup = new Map<string, (typeof publishedCandidates)[number]>();
    for (const candidate of publishedCandidates) {
      if (!candidate.publishedTo) continue;
      try {
        const parsed = JSON.parse(candidate.publishedTo) as Record<string, unknown>;
        const mappedId = parsed?.[adapter.provider];
        if (typeof mappedId === 'string' && mappedId.trim()) {
          publishedLookup.set(mappedId.trim(), candidate);
        }
      } catch {
        // Ignore malformed mappings and continue with direct remoteId matching.
      }
    }

    const now = new Date();
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    // Collect template IDs that belong to a GHL folder for assignment after sync
    const templateFolderAssignments: Array<{ localTemplateId: string; localFolderId: string }> = [];

    for (const remote of remoteTemplates) {
      if (!remote.id) continue;

      let existing = await prisma.espTemplate.findUnique({
        where: {
          accountKey_provider_remoteId: {
            accountKey,
            provider: adapter.provider,
            remoteId: remote.id,
          },
        },
      });

      if (!existing) {
        existing = publishedLookup.get(remote.id) ?? null;
      }

      if (existing) {
        // Skip templates that the user intentionally deleted locally
        if (existing.status === 'deleted-local') {
          unchanged++;
          continue;
        }

        const nextName = remote.name?.trim() || 'Untitled';
        const nextSubject = remote.subject?.trim() || null;
        const nextPreviewText = remote.previewText?.trim() || null;
        // GHL's list endpoint (and some other ESP list endpoints) return template
        // metadata only — no HTML body. Treat an empty remote.html as "no data
        // from remote, preserve local" so sync doesn't wipe a previously
        // populated html column.
        const nextHtml = remote.html && remote.html.length > 0 ? remote.html : existing.html;
        const nextStatus = remote.status || existing.status || 'active';
        const nextEditorType = remote.editorType || null;
        const nextThumbnailUrl = remote.thumbnailUrl || null;

        const nameChanged = nextName !== existing.name;
        const subjectChanged = nextSubject !== existing.subject;
        const previewTextChanged = nextPreviewText !== existing.previewText;
        const htmlChanged = nextHtml !== existing.html;
        const statusChanged = nextStatus !== existing.status;
        const editorTypeChanged = nextEditorType !== existing.editorType;
        const thumbChanged = nextThumbnailUrl !== existing.thumbnailUrl;
        const remoteIdChanged = existing.remoteId !== remote.id;

        if (
          nameChanged ||
          subjectChanged ||
          previewTextChanged ||
          htmlChanged ||
          statusChanged ||
          editorTypeChanged ||
          thumbChanged ||
          remoteIdChanged
        ) {
          await prisma.espTemplate.update({
            where: { id: existing.id },
            data: {
              ...(nameChanged && { name: nextName }),
              ...(subjectChanged && { subject: nextSubject }),
              ...(previewTextChanged && { previewText: nextPreviewText }),
              ...(htmlChanged && { html: nextHtml }),
              ...(statusChanged && { status: nextStatus }),
              ...(editorTypeChanged && { editorType: nextEditorType }),
              ...(thumbChanged && { thumbnailUrl: nextThumbnailUrl }),
              ...(remoteIdChanged && { remoteId: remote.id }),
              lastSyncedAt: now,
            },
          });
          updated++;
        } else {
          // Touch lastSyncedAt even if nothing changed
          await prisma.espTemplate.update({
            where: { id: existing.id },
            data: { lastSyncedAt: now },
          });
          unchanged++;
        }

        // Track folder assignment if template has a GHL parentId
        if (remote.parentId) {
          const localFolderId = remoteFolderIdToLocalId.get(remote.parentId);
          if (localFolderId) {
            templateFolderAssignments.push({
              localTemplateId: existing.id,
              localFolderId,
            });
          }
        }
      } else {
        // Create new local record
        const newTemplate = await prisma.espTemplate.create({
          data: {
            accountKey,
            provider: adapter.provider,
            remoteId: remote.id,
            name: remote.name || 'Untitled',
            subject: remote.subject || null,
            previewText: remote.previewText || null,
            html: remote.html || '',
            status: remote.status || 'active',
            editorType: remote.editorType || null,
            thumbnailUrl: remote.thumbnailUrl || null,
            lastSyncedAt: now,
          },
        });
        created++;

        // Track folder assignment if template has a GHL parentId
        if (remote.parentId) {
          const localFolderId = remoteFolderIdToLocalId.get(remote.parentId);
          if (localFolderId) {
            templateFolderAssignments.push({
              localTemplateId: newTemplate.id,
              localFolderId,
            });
          }
        }
      }
    }

    // ── Assign templates to their GHL folders ──
    if (templateFolderAssignments.length > 0) {
      try {
        const store = readEspTemplateFolderStore();
        for (const { localTemplateId, localFolderId } of templateFolderAssignments) {
          assignTemplatesToFolder(store, accountKey, [localTemplateId], localFolderId);
        }
        writeEspTemplateFolderStore(store);
      } catch (assignErr) {
        console.error('[sync] Failed to assign templates to folders:', assignErr);
      }
    }

    return NextResponse.json({
      sync: {
        provider: adapter.provider,
        accountKey,
        total: remoteTemplates.length,
        created,
        updated,
        unchanged,
        foldersSynced,
        foldersDeleted,
        folderRemoteIds,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to sync templates';
    const status =
      message.includes('(401)') ? 401 :
      message.includes('(403)') ? 403 :
      message.includes('(404)') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
