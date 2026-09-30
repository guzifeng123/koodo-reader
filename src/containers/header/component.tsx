import React from "react";
import "./header.css";
import SearchBox from "../../components/searchBox";
import ImportLocal from "../../components/importLocal";
import { HeaderProps, HeaderState } from "./interface";
import {
  ConfigService,
  KookitConfig,
} from "../../assets/lib/kookit-extra-browser.min";
import UpdateInfo from "../../components/dialogs/updateDialog";
import { generateSnapshot } from "../../utils/file/backup";
import { isElectron } from "react-device-detect";
import {
  upgradeConfig,
  upgradeStorage,
} from "../../utils/file/common";
import toast from "react-hot-toast";
import { Trans } from "react-i18next";
import DatabaseService from "../../utils/storage/databaseService";
import BookUtil from "../../utils/file/bookUtil";
import {
  getWebsiteUrl,
  openInBrowser,
  scanFolderForNewBooks,
  throttle,
  AUTO_IMPORT_FOLDERS_KEY,
} from "../../utils/common";
import { LocalFileManager } from "../../utils/file/localFile";
import packageJson from "../../../package.json";
import { getNotification } from "../../utils/request/common";
import TokenService from "../../utils/storage/tokenService";
declare var window: any;

class Header extends React.Component<HeaderProps, HeaderState> {
  private hasRunAutoImport: boolean = false;
  private resizeHandler: (() => void) | null = null;
  private readingFinishedHandler: ((config: any) => void) | null = null;
  constructor(props: HeaderProps) {
    super(props);

    this.state = {
      isOnlyLocal: false,
      language: ConfigService.getReaderConfig("lang"),
      isNewVersion: false,
      width: document.body.clientWidth,
      isHidePro: false,
      notificationCount: 0,
    };
  }
  async componentDidMount() {
    if (isElectron) {
      try {
        await generateSnapshot();
      } catch (error) {
        console.error("Failed to generate snapshot:", error);
      }
    }
    this.props.handleFetchAuthed();
    if (isElectron) {
      const fs = window.electronAPI.fs;
      const path = window.electronAPI.path;
      const ipcRenderer = window.electronAPI;
      const dirPath = ipcRenderer.sendSync("user-data", "ping");
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(path.join(dirPath, "data", "book"), { recursive: true });
      }

      if (
        ConfigService.getReaderConfig("storageLocation") &&
        !ConfigService.getItem("storageLocation")
      ) {
        ConfigService.setItem(
          "storageLocation",
          ConfigService.getReaderConfig("storageLocation")
        );
      }
      if (ConfigService.getReaderConfig("isHidePro") === "yes") {
        this.setState({ isHidePro: true });
      }

      //Check for data update
      //upgrade data from old version
      let res1 = await upgradeStorage(this.handleFinishUpgrade);
      let res2 = await upgradeConfig();
      if (!res1 || !res2) {
        console.error("upgrade failed");
      }

      this.readingFinishedHandler = async (_config: any) => {
        // cloud sync removed: no-op on reading finish
      };
      ipcRenderer.on("reading-finished", this.readingFinishedHandler);
      ipcRenderer.on("open-book-from-link", async (config: any) => {
        const book = await DatabaseService.getRecord(config.bookKey, "books");
        if (book) {
          BookUtil.redirectBook(book);
        }
      });
      ipcRenderer.on("open-note-from-link", async (config: any) => {
        const note = await DatabaseService.getRecord(config.noteKey, "notes");
        if (!note) return;
        const book = await DatabaseService.getRecord(note.bookKey, "books");
        if (!book) return;
        let bookLocation: any = {};
        try {
          bookLocation = JSON.parse(note.cfi) || {};
        } catch (error) {
          bookLocation.cfi = note.cfi;
          bookLocation.chapterTitle = note.chapter;
        }
        if (bookLocation.fingerprint) {
          bookLocation.chapterDocIndex = bookLocation.page - 1 + "";
          bookLocation.chapterHref = "title" + (bookLocation.page - 1);
        }
        ConfigService.setObjectConfig(
          note.bookKey,
          bookLocation,
          "recordLocation"
        );
        BookUtil.redirectBook(book);
      });
      ipcRenderer.on("chat-message", async (msg: any) => {
        if (msg.payload.event === "new-message") {
          ConfigService.setReaderConfig("isAllowNotification", "yes");
        }
      });
    } else {
      await upgradeConfig();
      const status = await LocalFileManager.getPermissionStatus();
      if (
        !ConfigService.getItem("isUseLocal") &&
        LocalFileManager.isSupported()
      ) {
        this.props.handleLocalFileDialog(true);
      } else if (
        ConfigService.getItem("isUseLocal") === "yes" &&
        !status.directoryName
      ) {
        this.props.handleLocalFileDialog(true);
      } else if (
        ConfigService.getItem("isUseLocal") === "yes" &&
        (status.needsReauthorization || !status.hasAccess)
      ) {
        this.props.handleLocalFileDialog(true);
      }
    }
    this.resizeHandler = throttle(() => {
      this.setState({ width: document.body.clientWidth });
    });
    window.addEventListener("resize", this.resizeHandler);
    this.handleOpenLastReadBook();
    this.autoScanFoldersOnStart();
  }
  componentWillUnmount() {
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
    if (isElectron && this.readingFinishedHandler) {
      const ipcRenderer = window.electronAPI;
      ipcRenderer.removeListener(
        "reading-finished",
        this.readingFinishedHandler
      );
      this.readingFinishedHandler = null;
    }
  }
  async UNSAFE_componentWillReceiveProps(
    nextProps: Readonly<HeaderProps>,
    _nextContext: any
  ) {
    if (nextProps.isAuthed && nextProps.isAuthed !== this.props.isAuthed) {
      if (ConfigService.getReaderConfig("isAllowNotification") === "yes") {
        getNotification()
          .then((res) => {
            if (
              res.data &&
              res.data.result === "ok" &&
              res.data.unread &&
              res.data.unread > 0
            ) {
              this.setState({ notificationCount: res.data.unread });
              ConfigService.setReaderConfig("isAllowNotification", "no");
            }
          })
          .catch(() => {
            // WebView/offline/no-account build: notification endpoint may be
            // unreachable. Silently swallow to avoid unhandled rejection/popup.
          });
      }
    }
  }
  autoScanFoldersOnStart = async () => {
    if (!isElectron || this.hasRunAutoImport) return;
    this.hasRunAutoImport = true;
    try {
      const folders =
        ConfigService.getAllListConfig(AUTO_IMPORT_FOLDERS_KEY) || [];
      if (folders.length === 0) return;
      const importBookFunc = this.props.importBookFunc;
      if (!importBookFunc) {
        console.error("Auto import: no import function available");
        return;
      }
      for (const folderPath of folders) {
        await scanFolderForNewBooks(folderPath, importBookFunc);
      }
    } catch (error) {
      console.error("Auto import folder scan error:", error);
    }
  };
  handleOpenLastReadBook = async () => {
    let filePath = "";
    //open book when app start
    if (isElectron) {
      const ipcRenderer = window.electronAPI;
      filePath = ipcRenderer.sendSync("check-file-data");
    }
    if (
      ConfigService.getReaderConfig("isOpenBook") === "yes" &&
      !this.props.currentBook.key &&
      !filePath
    ) {
      let lastReadBookKey = ConfigService.getAllListConfig("recentBooks")[0];
      if (lastReadBookKey) {
        let fullBook = await DatabaseService.getRecord(
          lastReadBookKey,
          "books"
        );
        if (fullBook) {
          this.props.handleReadingBook(fullBook);
          BookUtil.redirectBook(fullBook);
        }
      }
    }
  };
  handleFinishUpgrade = () => {
    this.props.handleFetchBooks();
    setTimeout(() => {
      if (this.props.mode === "home") {
        this.props.history.push("/manager/home");
      }
    }, 2000);
  };

  render() {
    return (
      <div
        className="header"
        style={this.props.isCollapsed ? { marginLeft: "40px" } : {}}
      >
        <div
          className="header-search-container"
          style={this.props.isCollapsed ? { width: "369px" } : {}}
        >
          <SearchBox />
        </div>
        <div
          className="setting-icon-parrent"
          style={this.props.isCollapsed ? { marginLeft: "430px" } : {}}
        >
          <div
            className="setting-icon-container"
            onClick={() => {
              this.props.handleSortDisplay(!this.props.isSortDisplay);
            }}
            onMouseLeave={() => {
              this.props.handleSortDisplay(false);
            }}
            style={{ top: "18px" }}
          >
            <span
              data-tooltip-id="my-tooltip"
              data-tooltip-content={this.props.t("Sort by")}
              data-tooltip-place="left"
            >
              <span className="icon-sort-desc header-sort-icon"></span>
            </span>
          </div>
          <div
            className="setting-icon-container"
            onClick={() => {
              this.props.handleSetting(true);
              this.props.handleAbout(false);
            }}
            onMouseLeave={() => {
              this.props.handleAbout(false);
            }}
            style={{ marginTop: "2px" }}
          >
            <span
              data-tooltip-id="my-tooltip"
              data-tooltip-content={this.props.t("Setting")}
              data-tooltip-place="left"
            >
              <span
                className="icon-setting setting-icon"
                style={{ fontSize: "25px" }}
              ></span>
            </span>
          </div>
        </div>

        {KookitConfig.CloudMode !== "production" ? (
          <div className="header-report-container" style={{ right: "300px" }}>
            <span
              style={{
                color: "red",
                opacity: 1,
                fontWeight: "bold",
              }}
            >
              <Trans>TEST</Trans>
              <span> </span>
            </span>
          </div>
        ) : null}

        <ImportLocal
          {...({
            handleDrag: this.props.handleDrag,
          } as any)}
        />
        <UpdateInfo />
      </div>
    );
  }
}

export default Header;
