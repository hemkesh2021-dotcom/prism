import { IconInfoCircle, IconTrash, IconWaveSine } from "@tabler/icons-react";
import { useState } from "react";
import { Wordmark } from "@/components/brand/Wordmark";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMotionPreference, type MotionPreference } from "@/lib/motion";
import { AboutDialog } from "./AboutDialog";

const MOTION_LABEL: Record<MotionPreference, string> = { system: "Match system", reduced: "Reduced", full: "Full" };

function MotionMenu() {
  const { preference, setPreference, reduced } = useMotionPreference();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="md" aria-label={`Motion: ${MOTION_LABEL[preference]}`}>
          <IconWaveSine size={18} stroke={1.75} aria-hidden />
          <span className="hidden lg:inline">Motion</span>
          <span className="hidden text-ink-2 lg:inline">{reduced ? "reduced" : "on"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Motion</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={preference} onValueChange={(v) => setPreference(v as MotionPreference)}>
          <DropdownMenuRadioItem value="system">
            <span>
              <span className="block font-semibold">Match system</span>
              <span className="block text-[13px] text-ink-2">Follows your device's reduce-motion setting.</span>
            </span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="reduced">
            <span>
              <span className="block font-semibold">Reduced</span>
              <span className="block text-[13px] text-ink-2">Static lens, no parallax or animated scrolling.</span>
            </span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="full">
            <span>
              <span className="block font-semibold">Full</span>
              <span className="block text-[13px] text-ink-2">Gentle lens movement and transitions.</span>
            </span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface HeaderProps {
  hasSessionData: boolean;
  onClearSession: () => void;
  promptVersion?: string;
  appVersion?: string;
}

export function Header({ hasSessionData, onClearSession, promptVersion, appVersion }: HeaderProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <header className="relative z-20">
      <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
        {/* Not a link: reloading the page would silently discard the in-memory session. */}
        <Wordmark />

        <nav aria-label="Session" className="flex items-center gap-1">
          <MotionMenu />
          <Button variant="ghost" onClick={() => setAboutOpen(true)} aria-label="About PRISM">
            <IconInfoCircle size={18} stroke={1.75} aria-hidden />
            <span className="hidden sm:inline">About</span>
          </Button>
          <Button
            variant="ghost"
            onClick={() => (hasSessionData ? setConfirmOpen(true) : onClearSession())}
            aria-label="Clear session"
          >
            <IconTrash size={18} stroke={1.75} aria-hidden />
            <span className="hidden sm:inline">Clear session</span>
          </Button>
        </nav>
      </div>

      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} promptVersion={promptVersion} appVersion={appVersion} />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent
          title="Clear this session?"
          description="This removes the transcript, preview, results and your review notes from this tab. Download the report first if you need it."
        >
          <p className="text-[14px] text-ink-2">
            PRISM keeps them only in this tab's memory, so clearing cannot be undone. It does not affect data the AI provider
            may already have processed for a live analysis.
          </p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Keep working</Button>
            </DialogClose>
            <Button
              variant="primary"
              onClick={() => {
                onClearSession();
                setConfirmOpen(false);
              }}
            >
              Clear session
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
