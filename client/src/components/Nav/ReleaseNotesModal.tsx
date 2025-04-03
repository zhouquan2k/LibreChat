import { memo, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import DialogTemplate from '~/components/ui/DialogTemplate';
import { OGDialog } from '~/components/ui';
import { useLocalize } from '~/hooks';

const ReleaseNotesModal = ({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (isOpen: boolean) => void;
}) => {
    const localize = useLocalize();
    const [changelog, setChangelog] = useState('');

    useEffect(() => {
        if (open) {
            fetch('/CHANGELOG.md')
                .then(response => response.text())
                .then(text => setChangelog(text))
                .catch(error => {
                    console.error('Error loading changelog:', error);
                    setChangelog('Failed to load changelog.');
                });
        }
    }, [open]);

    return (
        <OGDialog open={open} onOpenChange={onOpenChange}>
            <DialogTemplate
                title={localize('com_nav_release_notes')}
                className="w-11/12 max-w-3xl sm:w-3/4 md:w-1/2 lg:w-2/5"
                main={
                    <section
                        tabIndex={0}
                        className="max-h-[60vh] overflow-y-auto p-4"
                        aria-label={localize('com_nav_release_notes')}
                    >
                        <div className="prose dark:prose-invert w-full max-w-none !text-text-primary">
                            <ReactMarkdown>{changelog}</ReactMarkdown>
                        </div>
                    </section>
                }
            />
        </OGDialog>
    );
};

export default memo(ReleaseNotesModal);