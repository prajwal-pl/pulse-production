"use server";

import { db } from "@/lib/db";
import { currentUser } from "@clerk/nextjs/server";
import { Client } from "@notionhq/client";

export const onNotionConnect = async (
  access_token: string,
  workspace_id: string,
  workspace_icon: string,
  workspace_name: string,
  database_id: string,
  id: string
) => {
  "use server";
  if (access_token) {
    //check if notion is connected
    const notion_connected = await db.notion.findFirst({
      where: {
        accessToken: access_token,
      },
      include: {
        connections: {
          select: {
            type: true,
          },
        },
      },
    });

    if (!notion_connected) {
      //create connection
      await db.notion.create({
        data: {
          userId: id,
          workspaceIcon: workspace_icon!,
          accessToken: access_token,
          workspaceId: workspace_id!,
          workspaceName: workspace_name!,
          databaseId: database_id,
          connections: {
            create: {
              userId: id,
              type: "Notion",
            },
          },
        },
      });
    }
  }
};
export const getNotionConnection = async () => {
  const user = await currentUser();
  if (user) {
    const connection = await db.notion.findFirst({
      where: {
        userId: user.id,
      },
    });
    if (connection) {
      return connection;
    }
  }
};

export const getNotionDatabase = async (
  databaseId: string,
  accessToken: string
) => {
  const notion = new Client({
    auth: accessToken,
  });
  const response = await notion.databases.retrieve({ database_id: databaseId });
  return response;
};

export const onCreateNewPageInDatabase = async (
  databaseId: string,
  accessToken: string,
  content: string
): Promise<{ success: boolean; message: string; response?: any }> => {
  if (!databaseId || !accessToken) {
    return { success: false, message: "Missing database ID or access token" };
  }

  if (!content || content.trim() === "") {
    content = "Untitled";
  }

  const notion = new Client({
    auth: accessToken,
  });

  console.log("Creating Notion page in database:", databaseId);
  console.log("Content:", content);

  try {
    const response = await notion.pages.create({
      parent: {
        type: "database_id",
        database_id: databaseId,
      },
      properties: {
        name: {
          title: [
            {
              text: {
                content: content,
              },
            },
          ],
        },
      },
    });

    if (response) {
      console.log("Notion page created successfully:", response.id);
      return { success: true, message: "Page created", response };
    }

    return { success: false, message: "No response from Notion" };
  } catch (error: any) {
    console.error("Notion API error:", error.message);
    throw error; // Re-throw to be handled by caller
  }
};
