"use client";
import React, { useState } from "react";
import { useModal } from "../providers/modal-provider";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Button } from "../ui/button";
import { Loader2 } from "lucide-react";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { onCreateWorkflow } from "@/app/(main)/(pages)/workflows/_actions/workflow-connections";
import { toast } from "sonner";

type Props = {
  title?: string;
  subTitle?: string;
};

const WorkFlowForm = ({ title, subTitle }: Props) => {
  const { setClose } = useModal();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    console.log("Submitting with name:", name, "description:", description);

    if (!name.trim()) {
      toast.error("Workflow name is required");
      return;
    }

    setIsLoading(true);
    try {
      const workflow = await onCreateWorkflow(name.trim(), description.trim());
      console.log("Server response:", workflow);

      if (workflow) {
        toast.message(workflow.message);
        if (workflow.message === "workflow created") {
          setClose();
          router.refresh();
        }
      }
    } catch (error) {
      console.error("Error submitting form:", error);
      toast.error("Failed to create workflow");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-[650px] border-none">
      {title && subTitle && (
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{subTitle}</CardDescription>
        </CardHeader>
      )}
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-left">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isLoading}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isLoading}
            />
          </div>
          <Button className="mt-4" disabled={isLoading} type="submit">
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving
              </>
            ) : (
              "Save Settings"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

export default WorkFlowForm;
