import {
    useEffect,
    useRef,
    type ChangeEvent,
} from 'react';
import Editor from '@monaco-editor/react';

interface EditorModalProps {
    isOpen: boolean;
    content: string;
    error: string;
    onSave: () => void;
    onCancel: () => void;
    onExport: () => void;
    onContentChange: (value: string) => void;
}

const EditorModal = ({
    isOpen,
    content,
    error,
    onSave,
    onCancel,
    onExport,
    onContentChange,
}: EditorModalProps) => {
    const cancelButtonRef = useRef<HTMLButtonElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!isOpen) return;

        cancelButtonRef.current?.focus();
        const handleKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') onCancel();
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onCancel]);

    const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            onContentChange(await file.text());
        } catch (importError) {
            console.error('Failed to import bookmarks:', importError);
        } finally {
            event.target.value = '';
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-40 flex justify-center items-center">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="bookmark-editor-title"
                aria-describedby={error ? 'bookmark-editor-error' : undefined}
                className="bg-white rounded-lg shadow-xl w-3/4 h-3/4 flex flex-col"
            >
                <div className="py-2 px-5 border-b flex justify-between items-center">
                    <h2
                        id="bookmark-editor-title"
                        className="text-xl font-bold text-neutral-800"
                    >
                        Edit Bookmarks
                    </h2>
                    <div className="flex items-center gap-2">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="application/json,.json"
                            className="hidden"
                            onChange={handleImport}
                        />
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="bg-gray-200 hover:bg-gray-300 text-black font-medium py-1.5 px-3 rounded"
                        >
                            Import
                        </button>
                        <button
                            type="button"
                            onClick={onExport}
                            className="bg-gray-200 hover:bg-gray-300 text-black font-medium py-1.5 px-3 rounded"
                        >
                            Export
                        </button>
                        <button
                            type="button"
                            onClick={onSave}
                            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-1.5 px-4 rounded"
                        >
                            Save
                        </button>
                        <button
                            ref={cancelButtonRef}
                            type="button"
                            onClick={onCancel}
                            className="bg-gray-300 hover:bg-gray-400 text-black font-bold py-1.5 px-4 rounded"
                        >
                            Cancel
                        </button>
                    </div>
                </div>

                {error && (
                    <p
                        id="bookmark-editor-error"
                        role="alert"
                        className="bg-red-50 px-5 py-2 text-sm text-red-700"
                    >
                        {error}
                    </p>
                )}

                <div className="flex-grow">
                    <Editor
                        height="100%"
                        language="json"
                        value={content}
                        onChange={(value) => onContentChange(value || '')}
                        theme="vs-dark"
                    />
                </div>
            </div>
        </div>
    );
};

export default EditorModal;
