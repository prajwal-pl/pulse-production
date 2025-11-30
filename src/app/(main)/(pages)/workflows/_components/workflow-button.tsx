"use client";
import WorkFlowForm from "@/components/forms/workflow-form";
import CustomModal from "@/components/global/custom-modal";
import { useBilling } from "@/components/providers/billing-provider";
import { useModal } from "@/components/providers/modal-provider";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import React from "react";

type Props = {};

const WorkflowButton = (props: Props) => {
  const { setOpen, setClose } = useModal();
  const { credits } = useBilling();

  const handleClick = () => {
    setOpen(
      <CustomModal
        title="Create a Workflow Automation"
        subHeading="Workflows are a powerful way to help you automate tasks."
      >
        <WorkFlowForm />
      </CustomModal>
    );
  };
  return (
    <Button
      size={'icon'}
      {...(credits !== '0'
        ? {
          onClick: handleClick,
        }
        : {
          disabled: true,
        })}
    >
      <Plus />
    </Button>
  );
};

export default WorkflowButton;
