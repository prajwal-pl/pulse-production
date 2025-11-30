"use server";

import { Option } from "@/components/ui/multiple-selector";
import { db } from "@/lib/db";
import { currentUser } from "@clerk/nextjs/server";
import axios from "axios";

export const onSlackConnect = async (
  app_id: string,
  authed_user_id: string,
  authed_user_token: string,
  slack_access_token: string,
  bot_user_id: string,
  team_id: string,
  team_name: string,
  user_id: string
): Promise<void> => {
  if (!slack_access_token) return;

  const slackConnection = await db.slack.findFirst({
    where: { slackAccessToken: slack_access_token },
    include: { connections: true },
  });

  if (!slackConnection) {
    await db.slack.create({
      data: {
        userId: user_id,
        appId: app_id,
        authedUserId: authed_user_id,
        authedUserToken: authed_user_token,
        slackAccessToken: slack_access_token,
        botUserId: bot_user_id,
        teamId: team_id,
        teamName: team_name,
        connections: {
          create: { userId: user_id, type: "Slack" },
        },
      },
    });
  }
};

export const getSlackConnection = async () => {
  const user = await currentUser();
  if (user) {
    return await db.slack.findFirst({
      where: { userId: user.id },
    });
  }
  return null;
};

export async function listBotChannels(
  slackAccessToken: string
): Promise<Option[]> {
  const url = `https://slack.com/api/conversations.list?${new URLSearchParams({
    types: "public_channel,private_channel",
    limit: "200",
  })}`;

  try {
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${slackAccessToken}` },
    });

    console.log(data);

    if (!data.ok) throw new Error(data.error);

    if (!data?.channels?.length) return [];

    return data.channels
      .filter((ch: any) => ch.is_member)
      .map((ch: any) => {
        return { label: ch.name, value: ch.id };
      });
  } catch (error: any) {
    console.error("Error listing bot channels:", error.message);
    throw error;
  }
}

const postMessageInSlackChannel = async (
  slackAccessToken: string,
  slackChannel: string,
  content: string
): Promise<{ success: boolean; channel: string; error?: string }> => {
  try {
    const response = await axios.post(
      "https://slack.com/api/chat.postMessage",
      { channel: slackChannel, text: content },
      {
        headers: {
          Authorization: `Bearer ${slackAccessToken}`,
          "Content-Type": "application/json;charset=utf-8",
        },
      }
    );

    // Slack API returns ok: true/false in response body
    if (response.data?.ok) {
      console.log(`Message posted successfully to channel ID: ${slackChannel}`);
      return { success: true, channel: slackChannel };
    } else {
      console.error(`Slack API error for channel ${slackChannel}:`, response.data?.error);
      return { success: false, channel: slackChannel, error: response.data?.error };
    }
  } catch (error: any) {
    console.error(
      `Error posting message to Slack channel ${slackChannel}:`,
      error?.response?.data || error.message
    );
    return { success: false, channel: slackChannel, error: error.message };
  }
};

// Wrapper function to post messages to multiple Slack channels
export const postMessageToSlack = async (
  slackAccessToken: string,
  selectedSlackChannels: Option[],
  content: string
): Promise<{ message: string }> => {
  if (!content || content.trim() === "") {
    return { message: "Content is empty" };
  }
  if (!selectedSlackChannels?.length) {
    return { message: "Channel not selected" };
  }
  if (!slackAccessToken) {
    return { message: "Slack access token missing" };
  }

  try {
    // Get all valid channel values
    const channelValues = selectedSlackChannels
      .map((channel) => channel?.value)
      .filter((value): value is string => Boolean(value));

    if (channelValues.length === 0) {
      return { message: "No valid channels to send to" };
    }

    // Use Promise.all to properly await all messages
    const results = await Promise.all(
      channelValues.map((channel) =>
        postMessageInSlackChannel(slackAccessToken, channel, content)
      )
    );

    const successCount = results.filter((r) => r.success).length;
    const failedCount = results.filter((r) => !r.success).length;

    if (successCount === 0) {
      const errors = results.map((r) => r.error).filter(Boolean).join(", ");
      return { message: `Failed to send: ${errors}` };
    }

    if (failedCount > 0) {
      return { message: `Partial success: ${successCount}/${results.length} channels` };
    }

    return { message: "Success" };
  } catch (error: any) {
    console.error("Error in postMessageToSlack:", error.message);
    return { message: "Message could not be sent to Slack" };
  }
};
