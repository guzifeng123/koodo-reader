import React from "react";
import { SettingInfoProps, SettingInfoState } from "./interface";
import { Trans } from "react-i18next";
import {
  clearAllData,
  getStorageLocation,
  reloadManager,
  vexComfirmAsync,
  vexPromptAsync,
} from "../../../utils/common";

import toast from "react-hot-toast";
import { isElectron } from "react-device-detect";
import { LocalFileManager } from "../../../utils/file/localFile";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { changeLibrary, changePath } from "../../../utils/file/common";
import { backup, getSnapshots } from "../../../utils/file/backup";
import { restore, restoreFromSnapshot } from "../../../utils/file/restore";
import {
  exportBooks,
  exportDictionaryHistory,
  exportHighlights,
  exportNotes,
} from "../../../utils/file/export";
import { importNotesData } from "../../../utils/file/importData";
import DatabaseService from "../../../utils/storage/databaseService";
import { dataSettingList } from "../../../constants/settingList";
declare var window: any;
class DataSetting extends React.Component<SettingInfoProps, SettingInfoState> {
  constructor(props: SettingInfoProps) {
    super(props);
    this.state = {
      storageLocation: getStorageLocation() || "",
      snapshotList: [],
      exportNotesFormat: "",
      exportHighlightsFormat: "",
      exportWordsFormat: "",
      isEnableDiscordRPC:
        ConfigService.getReaderConfig("isEnableDiscordRPC") === "yes",
    };
  }
  async componentDidMount() {
    if (!isElectron) {
      const status = await LocalFileManager.getPermissionStatus();
      this.setState({
        storageLocation: status.directoryName || "",
        snapshotList: [],
      });
    }
    if (isElectron) {
      this.setState({
        snapshotList: getSnapshots(),
      });
    }
  }
  handleSetting = (stateName: string) => {
    this.setState({ [stateName]: !this.state[stateName] } as any);
    ConfigService.setReaderConfig(
      stateName,
      this.state[stateName] ? "no" : "yes"
    );
    toast.success(this.props.t("Change successful"));
  };

  handleDataSetting = async (item: any) => {
    this.handleSetting(item.propName);
  };

  renderSwitchOption = (optionList: any[]) => {
    return optionList.map((item) => {
      return (
        <div
          style={item.isElectron ? (isElectron ? {} : { display: "none" }) : {}}
          key={item.propName}
        >
          <div className="setting-dialog-new-title" key={item.title}>
            <span style={{ width: "calc(100% - 100px)" }}>
              <Trans>{item.title}</Trans>
            </span>
            <span
              className="single-control-switch"
              onClick={() => {
                this.handleDataSetting(item);
              }}
              style={this.state[item.propName] ? {} : { opacity: 0.6 }}
            >
              <span
                className="single-control-button"
                style={
                  this.state[item.propName]
                    ? {
                        transform: "translateX(20px)",
                        transition: "transform 0.5s ease",
                      }
                    : {
                        transform: "translateX(0px)",
                        transition: "transform 0.5s ease",
                      }
                }
              ></span>
            </span>
          </div>
          <p className="setting-option-subtitle">
            <Trans>{item.desc}</Trans>
          </p>
        </div>
      );
    });
  };

  handleChangeLocation = async () => {
    const ipcRenderer = window.electronAPI;
    const newPath = await ipcRenderer.invoke("select-path");
    if (!newPath) {
      return;
    }
    let isSuccess = await changePath(newPath);
    if (!isSuccess) {
      toast.error(this.props.t("Change failed"));
      return;
    }
    ConfigService.setItem("storageLocation", newPath);
    this.setState({ storageLocation: newPath });

    toast.success(this.props.t("Change successful"));
    this.props.handleFetchBooks();
  };
  handleSwitchLibrary = async () => {
    if (isElectron) {
      const ipcRenderer = window.electronAPI;
      const newPath = await ipcRenderer.invoke("select-path");
      if (!newPath) {
        return;
      }
      let isSuccess = await changeLibrary(newPath);
      if (!isSuccess) {
        toast.error(this.props.t("Switch failed"));
        return;
      }
      ConfigService.setItem("storageLocation", newPath);
      this.setState({ storageLocation: newPath });
      try {
        let fs = window.electronAPI.fs;
        let text = fs.readFileSync(
          window.electronAPI.path.join(newPath, "config", "config.json"),
          "utf-8"
        );
        let config = JSON.parse(text);
        for (let key in config) {
          ConfigService.setItem(key, config[key]);
        }
      } catch (error) {
        console.error("Error reading config.json:", error);
      }
      toast.success(this.props.t("Switch successful"));
      this.props.handleFetchBooks();
      setTimeout(() => {
        this.props.history.push("/manager/home");
      }, 2000);
    } else {
      try {
        const directoryHandle = await LocalFileManager.requestDirectoryAccess();

        if (directoryHandle) {
          // 成功获取权限
          ConfigService.setItem("isUseLocal", "yes");
          this.setState({
            storageLocation: directoryHandle.name,
          });
          toast.success(
            this.props.t("Local folder access granted successfully")
          );
          this.props.handleFetchBooks();
          setTimeout(() => {
            this.props.history.push("/manager/home");
          }, 2000);
        } else {
          toast.success(this.props.t("Failed to get folder access permission"));
        }
      } catch (error) {
        toast.error(
          "Error selecting folder:" +
            (error instanceof Error ? error.message : String(error))
        );
        console.error("Error selecting folder:", error);
        toast.success(this.props.t("Error occurred while selecting folder"));
      }
    }
  };
  handleRestoreSnapshot = async (event: any) => {
    let targetFile = event.target.value;
    if (!targetFile) {
      return;
    }
    let confirm = await vexComfirmAsync(
      this.props.t(
        "Restoring from a snapshot will overwrite your current data. Are you sure you want to continue?"
      )
    );
    if (!confirm) {
      return;
    }
    let result = await restoreFromSnapshot(targetFile);
    if (result) {
      toast.success(this.props.t("Restore successful"), {
        id: "restore-snapshot",
      });
      this.props.handleFetchBooks();
      setTimeout(() => {
        this.props.history.push("/manager/home");
      }, 2000);
    }
    event.target.value = "";
  };
  handleImportNotesData = async () => {
    const result = await importNotesData();
    if (result === "cancel" || result === "failed") {
      return;
    }
    const { imported, skipped } = result as {
      imported: number;
      skipped: number;
    };
    toast.success(
      this.props.t(
        "Imported {{imported}} records, skipped {{skipped}} existing records",
        { imported, skipped }
      )
    );
    this.props.handleFetchBooks();
  };
  render() {
    return (
      <>
        {this.renderSwitchOption(dataSettingList)}
        <div className="setting-dialog-new-title">
          <Trans>Backup library to a local file</Trans>
          <span
            className="change-location-button"
            onClick={async () => {
              let result = await backup("local");
              if (result === "cancel") {
                return;
              }
              if (result === "success") {
                toast.success(this.props.t("Execute successful"), {
                  id: "backup",
                });
                this.props.handleFetchBooks();
              } else {
                toast.error(this.props.t("Backup failed"), { id: "backup" });
              }
            }}
          >
            <Trans>Backup</Trans>
          </span>
        </div>
        <p className="setting-option-subtitle">
          <Trans>
            Download a full backup of your library (books, covers, config and
            databases) as a single .zip file to your device.
          </Trans>
        </p>
        <div className="setting-dialog-new-title">
          <Trans>Restore library from a local file</Trans>
          <span
            className="change-location-button"
            onClick={async () => {
              let result = await restore("local");
              if (result === "cancel") {
                return;
              }
              if (result === "success") {
                toast.success(this.props.t("Execute successful"), {
                  id: "backup",
                });
                this.props.handleFetchBooks();
                setTimeout(() => {
                  this.props.history.push("/manager/home");
                }, 2000);
              } else {
                toast.error(
                  this.props.t("Download failed,network problem or no backup"),
                  { id: "backup" }
                );
              }
            }}
          >
            <Trans>Restore</Trans>
          </span>
        </div>
        <p className="setting-option-subtitle">
          <Trans>
            Select a previously exported .zip backup file to restore your library.
          </Trans>
        </p>
        {isElectron && (
          <>
            <div className="setting-dialog-new-title">
              <Trans>Change storage location</Trans>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                {" "}
                <span
                  className="change-location-button"
                  onClick={() => {
                    const ipcRenderer = window.electronAPI;
                    ipcRenderer.invoke("open-explorer-folder", {
                      path: this.state.storageLocation,
                      isFolder: true,
                    });
                  }}
                  style={{ marginRight: "10px" }}
                >
                  <Trans>Locate</Trans>
                </span>
                <span
                  className="change-location-button"
                  onClick={() => {
                    this.handleChangeLocation();
                  }}
                >
                  <Trans>Select</Trans>
                </span>
              </div>
            </div>
            <p className="setting-option-subtitle">
              <Trans>
                {
                  "Modify the storage location of the library, and the library will be moved to the new location. Please ensure that the new folder is empty"
                }
              </Trans>
            </p>
            <div className="setting-dialog-location-title">
              {this.state.storageLocation}
            </div>
          </>
        )}
        {this.state.storageLocation && (
          <>
            <div className="setting-dialog-new-title">
              <Trans>Switch Library</Trans>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                {isElectron && (
                  <span
                    className="change-location-button"
                    onClick={() => {
                      const ipcRenderer = window.electronAPI;
                      ipcRenderer.invoke("open-explorer-folder", {
                        path: this.state.storageLocation,
                        isFolder: true,
                      });
                    }}
                    style={{ marginRight: "10px" }}
                  >
                    <Trans>Locate</Trans>
                  </span>
                )}
                <span
                  className="change-location-button"
                  onClick={() => {
                    this.handleSwitchLibrary();
                  }}
                >
                  <Trans>Select</Trans>
                </span>
              </div>
            </div>
            <p className="setting-option-subtitle">
              <Trans>
                {
                  "Switch between multiple libraries without affecting the original library."
                }
              </Trans>
            </p>
            <div className="setting-dialog-location-title">
              {this.state.storageLocation}
            </div>
          </>
        )}
        {isElectron && (
          <>
            <div className="setting-dialog-new-title">
              <Trans>Restore from snapshots</Trans>
              <select
                name=""
                className="lang-setting-dropdown"
                onChange={this.handleRestoreSnapshot}
              >
                <option value={""} className="lang-setting-option">
                  {this.props.t("Please select")}
                </option>
                {this.state.snapshotList
                  .map((item) => {
                    return {
                      label: new Date(item.time).toLocaleString(),
                      value: item.file,
                    };
                  })
                  .map((item) => (
                    <option
                      value={item.value}
                      key={item.value}
                      className="lang-setting-option"
                    >
                      {item.label}
                    </option>
                  ))}
              </select>
            </div>
            <p className="setting-option-subtitle">
              <Trans>
                {
                  "Each time you open Koodo Reader, it automatically creates a snapshot of your library (excluding books and covers). You can use these snapshots to restore your library to a previous state. Please note that restoring from a snapshot will overwrite your current data"
                }
              </Trans>
            </p>
          </>
        )}
        <div className="setting-dialog-new-title">
          <Trans>Export all books</Trans>
          <span
            className="change-location-button"
            onClick={async () => {
              let books = await DatabaseService.getAllRecords("books");
              if (books.length > 0) {
                const result = await exportBooks(books);
                if (result === "success") {
                  toast.success(this.props.t("Export successful"), { id: "exporting" });
                } else if (result === "failed") {
                  toast.dismiss("exporting");
                  toast.error(this.props.t("Failed to export"), { id: "exporting" });
                }
              } else {
                toast(this.props.t("Nothing to export"));
              }
            }}
          >
            <Trans>Export</Trans>
          </span>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>Export all notes</Trans>
          <select
            className="lang-setting-dropdown"
            value={this.state.exportNotesFormat}
            onChange={async (event) => {
              const fmt = event.target.value as
                | "csv"
                | "md"
                | "txt"
                | "html"
                | "pdf"
                | "json"
                | "";
              if (!fmt) return;
              this.setState({ exportNotesFormat: "" });
              let books = await DatabaseService.getAllRecords("books");
              let notes = await DatabaseService.getAllRecords("notes");
              notes = notes.filter(
                (note: any) =>
                  note.notes &&
                  note.notes.length > 0 &&
                  note.notes !== "annotation"
              );
              if (notes.length > 0) {
                const result = await exportNotes(notes, books, fmt);
                if (result === "success") {
                  toast.success(this.props.t("Export successful"), { id: "exporting" });
                } else if (result === "failed") {
                  toast.error(this.props.t("Failed to export"), { id: "exporting" });
                }
              } else {
                toast(this.props.t("Nothing to export"));
              }
            }}
          >
            <option value="" className="lang-setting-option">
              {this.props.t("Select format")}
            </option>
            <option value="csv" className="lang-setting-option">
              CSV
            </option>
            <option value="md" className="lang-setting-option">
              Markdown
            </option>
            <option value="txt" className="lang-setting-option">
              TXT
            </option>
            <option value="html" className="lang-setting-option">
              HTML
            </option>
            <option value="pdf" className="lang-setting-option">
              PDF
            </option>
            <option value="json" className="lang-setting-option">
              JSON
            </option>
          </select>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>Export all highlights</Trans>
          <select
            className="lang-setting-dropdown"
            value={this.state.exportHighlightsFormat}
            onChange={async (event) => {
              const fmt = event.target.value as
                | "csv"
                | "md"
                | "txt"
                | "html"
                | "pdf"
                | "json"
                | "";
              if (!fmt) return;
              this.setState({ exportHighlightsFormat: "" });
              let books = await DatabaseService.getAllRecords("books");
              let notes = await DatabaseService.getAllRecords("notes");
              notes = notes.filter((note: any) => note.notes === "");
              if (notes.length > 0) {
                const result = await exportHighlights(notes, books, fmt);
                if (result === "success") {
                  toast.success(this.props.t("Export successful"), { id: "exporting" });
                } else if (result === "failed") {
                  toast.error(this.props.t("Failed to export"), { id: "exporting" });
                }
              } else {
                toast(this.props.t("Nothing to export"));
              }
            }}
          >
            <option value="" className="lang-setting-option">
              {this.props.t("Select format")}
            </option>
            <option value="csv" className="lang-setting-option">
              CSV
            </option>
            <option value="md" className="lang-setting-option">
              Markdown
            </option>
            <option value="txt" className="lang-setting-option">
              TXT
            </option>
            <option value="html" className="lang-setting-option">
              HTML
            </option>
            <option value="pdf" className="lang-setting-option">
              PDF
            </option>
            <option value="json" className="lang-setting-option">
              JSON
            </option>
          </select>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>Export all dictionary history</Trans>
          <select
            className="lang-setting-dropdown"
            value={this.state.exportWordsFormat}
            onChange={async (event) => {
              const fmt = event.target.value as "csv" | "json" | "";
              if (!fmt) return;
              this.setState({ exportWordsFormat: "" });
              let dictHistory = await DatabaseService.getAllRecords("words");
              let books = await DatabaseService.getAllRecords("books");
              if (dictHistory.length > 0) {
                const result = await exportDictionaryHistory(dictHistory, books, fmt);
                if (result === "success") {
                  toast.success(this.props.t("Export successful"), { id: "exporting" });
                } else if (result === "failed") {
                  toast.error(this.props.t("Failed to export"), { id: "exporting" });
                }
              } else {
                toast(this.props.t("Nothing to export"));
              }
            }}
          >
            <option value="" className="lang-setting-option">
              {this.props.t("Select format")}
            </option>
            <option value="csv" className="lang-setting-option">
              CSV
            </option>
            <option value="json" className="lang-setting-option">
              JSON
            </option>
          </select>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>Import notes, highlights and dictionary history</Trans>
          <span
            className="change-location-button"
            onClick={this.handleImportNotesData}
          >
            <Trans>Select</Trans>
          </span>
        </div>
        <p className="setting-option-subtitle">
          <Trans>
            {
              "Select previously exported CSV or JSON files to import notes, highlights and dictionary history back to the library"
            }
          </Trans>
        </p>
        <div className="setting-dialog-new-title">
          <Trans>Clear all data</Trans>
          <span
            className="change-location-button"
            onClick={async () => {
              let answer = await vexPromptAsync(
                this.props.t("Please type 'CLEAR' to confirm"),
                "",
                ""
              );
              window.vex.closeAll(); // 关闭对话框
              if (answer === "CLEAR") {
                await clearAllData();
                toast.success(this.props.t("Clear successful"));
                setTimeout(() => {
                  reloadManager();
                }, 300);
              } else if (answer) {
                toast.error(this.props.t("Please type 'CLEAR' to confirm"));
              }
            }}
          >
            <Trans>Clear</Trans>
          </span>
        </div>
      </>
    );
  }
}

export default DataSetting;
