import Button from "@app/components/Common/Button";
import { SparklesIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/router";
import { defineMessages, useIntl } from "react-intl";

const messages = defineMessages({
  askAi: "Ask AI",
});

interface AskAiButtonProps {
  mediaType: "movie" | "tv";
  tmdbId: number;
  title: string;
  year?: string;
}

const AskAiButton = ({ mediaType, tmdbId, title, year }: AskAiButtonProps) => {
  const router = useRouter();
  const intl = useIntl();

  return (
    <Button
      buttonType="ghost"
      className="ml-2 first:ml-0"
      onClick={() =>
        router.push({
          pathname: "/ai",
          query: {
            mediaType,
            tmdbId: String(tmdbId),
            title,
            ...(year ? { year } : {}),
          },
        })
      }
    >
      <SparklesIcon />
      <span>{intl.formatMessage(messages.askAi)}</span>
    </Button>
  );
};

export default AskAiButton;
