import { devices, updatedAtNow, users, workspaces, type Database } from "@alfred/db";
import { hashToken } from "./token-hash.js";

export type BootstrapAuthConfig = {
  adminEmail: string;
  deviceId: string;
  deviceToken: string;
  userId: string;
  workspaceId: string;
};

export async function seedBootstrapAuth(db: Database, config: BootstrapAuthConfig): Promise<void> {
  await db
    .insert(users)
    .values({
      id: config.userId,
      email: config.adminEmail,
      displayName: config.adminEmail,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: config.adminEmail,
        updatedAt: updatedAtNow,
      },
    });

  await db
    .insert(workspaces)
    .values({
      id: config.workspaceId,
      ownerUserId: config.userId,
      workspaceKey: config.workspaceId,
      name: "Personal Workspace",
    })
    .onConflictDoUpdate({
      target: workspaces.id,
      set: {
        ownerUserId: config.userId,
        updatedAt: updatedAtNow,
      },
    });

  await db
    .insert(devices)
    .values({
      id: config.deviceId,
      workspaceId: config.workspaceId,
      deviceKey: config.deviceId,
      name: "Runner Device",
      tokenHash: hashToken(config.deviceToken),
    })
    .onConflictDoUpdate({
      target: devices.id,
      set: {
        workspaceId: config.workspaceId,
        tokenHash: hashToken(config.deviceToken),
        updatedAt: updatedAtNow,
      },
    });
}
