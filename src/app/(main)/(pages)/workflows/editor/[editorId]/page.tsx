"use client";
import { ConnectionsProvider } from "@/components/providers/connection-provider";
import EditorProvider from "@/components/providers/editor-provider";
import React, { useEffect, useState } from "react";
import EditorCanvas from "./_components/editor-canvas";
import { useParams } from "next/navigation";
import { onGetNodesEdges } from "../../_actions/workflow-connections";

type Props = {};

const Page = (props: Props) => {
  const params = useParams();
  const [templates, setTemplates] = useState({
    discord: "",
    slack: "",
    notion: "",
  });

  useEffect(() => {
    const loadTemplates = async () => {
      if (params.editorId) {
        const response = await onGetNodesEdges(params.editorId as string);
        if (response) {
          setTemplates({
            discord: response.discordTemplate || "",
            slack: response.slackTemplate || "",
            notion: response.notionTemplate || "",
          });
        }
      }
    };
    loadTemplates();
  }, [params.editorId]);

  return (
    <div className="h-full">
      <EditorProvider>
        <ConnectionsProvider initialTemplates={templates}>
          <EditorCanvas />
        </ConnectionsProvider>
      </EditorProvider>
    </div>
  );
};

export default Page;
