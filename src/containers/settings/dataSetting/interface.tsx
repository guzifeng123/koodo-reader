import { RouteComponentProps } from "react-router-dom";
export interface SettingInfoProps extends RouteComponentProps<any> {
  t: (title: string, options?: any) => string;
  isAuthed: boolean;
  handleFetchBooks: () => void;
}
export interface SettingInfoState {
  storageLocation: string;
  snapshotList: { file: string; time: number }[];
  exportNotesFormat: string;
  exportHighlightsFormat: string;
  exportWordsFormat: string;
  isEnableDiscordRPC: boolean;
  [key: string]: any;
}
