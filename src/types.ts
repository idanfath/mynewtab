export type BookMark = {
    title: string;
    url: string;
    description?: string;
    customIconUrl?: string;
};

export interface BookMarks {
    [key: string]: BookMark[];
}
