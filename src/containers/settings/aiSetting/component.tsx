import React from "react";
import { SettingInfoProps, SettingInfoState, AIModelConfig } from "./interface";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import { handleContextMenu, vexTextareaAsync } from "../../../utils/common";
import { aiRequest } from "../../../utils/request/common";
import {
  ConfigService,
  KookitConfig,
} from "../../../assets/lib/kookit-extra-browser.min";

class AISetting extends React.Component<SettingInfoProps, SettingInfoState> {
  constructor(props: SettingInfoProps) {
    super(props);
    this.state = {
      isAddNew: false,
      isEditing: false,
      editingKey: "",
      selectedProvider: "",
      selectedModel: "",
      endpoint: "",
      modelName: "",
      modelId: "",
      apiKey: "",
      isTesting: false,
      testResult: "",
      fetchedModels: [],
      isFetchingModels: false,
      aiTranslateModel: ConfigService.getReaderConfig("aiTranslateModel") || "",
      aiDictModel: ConfigService.getReaderConfig("aiDictModel") || "",
      aiAssistanceModel:
        ConfigService.getReaderConfig("aiAssistanceModel") || "",
      aiTranslatePrompt:
        ConfigService.getReaderConfig("aiTranslatePrompt") || "",
      aiDictPrompt: ConfigService.getReaderConfig("aiDictPrompt") || "",
      aiAssistancePrompt:
        ConfigService.getReaderConfig("aiAssistancePrompt") || "",
    };
  }

  getAIModels = () => {
    // Load AI models from ConfigService
    let aiModels: { key: string; displayName: string; config: any }[] = [];
    const aiModelConfig =
      ConfigService.getAllObjectConfig("aiModelConfig") || {};
    Object.values(aiModelConfig).forEach((entry: any) => {
      if (entry && entry.key) {
        aiModels.push({
          key: entry.key,
          displayName: entry.displayName,
          config: entry.config,
        });
      }
    });
    return aiModels;
  };

  parseConfig = (plugin: any): AIModelConfig | null => {
    try {
      if (typeof plugin.config === "string") {
        return JSON.parse(plugin.config);
      }
      return plugin.config as AIModelConfig;
    } catch {
      return null;
    }
  };

  resetForm = () => {
    this.setState({
      isAddNew: false,
      isEditing: false,
      editingKey: "",
      selectedProvider: "",
      selectedModel: "",
      endpoint: "",
      modelName: "",
      modelId: "",
      apiKey: "",
      isTesting: false,
      testResult: "",
      fetchedModels: [],
    });
  };

  handleModelSelect = (modelId: string) => {
    if (!modelId) {
      this.setState({ selectedModel: "", modelName: "", modelId: "" });
      return;
    }
    const found = this.state.fetchedModels.find((m) => m.id === modelId);
    this.setState({
      selectedModel: modelId,
      modelName: found ? found.name : modelId,
      modelId: modelId,
      testResult: "",
    });
  };

  handleFetchModels = async () => {
    const { endpoint, apiKey } = this.state;
    if (!endpoint) {
      toast.error(this.props.t("Please enter the endpoint first"));
      return;
    }
    this.setState({ isFetchingModels: true });
    try {
      // 直连用户自填的 OpenAI 兼容 endpoint：GET {endpoint}/models
      const modelsUrl = endpoint.replace(/\/+$/, "") + "/models";
      const headers: Record<string, string> = {};
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
      const response = await aiRequest(modelsUrl, "GET", headers);
      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${response.body.substring(0, 200)}`
        );
      }
      const data = JSON.parse(response.body);
      const rawModels = data.data || data.models || data.results || data || [];
      if (rawModels.length === 0) {
        toast.error(this.props.t("No models found"));
        toast.error(
          this.props.t(
            "You can add models manually by selecting the custom model"
          )
        );
        return;
      }
      const models = rawModels.map((m: any) => ({
        id: m.id || m.model || m.name,
        name: m.id || m.display_name || m.name || m.model,
      }));
      models.sort((a: { name: string }, b: { name: string }) =>
        a.name.localeCompare(b.name)
      );
      this.setState({ fetchedModels: models });
      if (models.length > 0) {
        toast.success(this.props.t("Fetched models") + ": " + models.length);
      } else {
        toast.error(this.props.t("No models found"));
      }
    } catch (e: any) {
      toast.error(
        this.props.t("Failed to fetch model list") + ": " + e.message
      );
    } finally {
      this.setState({ isFetchingModels: false });
    }
  };

  handleTest = async () => {
    const { endpoint, modelId, apiKey } = this.state;
    if (!endpoint) {
      toast.error(this.props.t("Please enter the endpoint first"));
      return;
    }
    this.setState({ isTesting: true, testResult: "" });
    try {
      if (!modelId) {
        // 未填模型名时，先验证 /models 连通性
        const modelsUrl = endpoint.replace(/\/+$/, "") + "/models";
        const headers: Record<string, string> = {};
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
        const response = await aiRequest(modelsUrl, "GET", headers);
        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}: ${response.body.substring(0, 200)}`
          );
        }
        this.setState({ testResult: "success" });
        toast.success(this.props.t("Test successful") + ": " + modelsUrl);
        return;
      }
      const chatEndpoint = endpoint.replace(/\/+$/, "") + "/chat/completions";
      const response = await aiRequest(
        chatEndpoint,
        "POST",
        {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        JSON.stringify({
          model: modelId,
          messages: [
            { role: "user", content: "Hi, just testing. Reply with OK." },
          ],
          max_tokens: 10,
        })
      );
      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${response.body.substring(0, 200)}`
        );
      }
      const data = JSON.parse(response.body);
      const reply =
        data.choices?.[0]?.message?.content ||
        JSON.stringify(data).substring(0, 100);
      this.setState({ testResult: "success" });
      toast.success(this.props.t("Test successful") + ": " + reply);
    } catch (e: any) {
      this.setState({ testResult: "fail" });
      toast.error(this.props.t("Test failed") + ": " + e.message);
    } finally {
      this.setState({ isTesting: false });
    }
  };

  handleSave = async () => {
    const { endpoint, modelId, apiKey, isEditing, editingKey } = this.state;
    if (!endpoint || !modelId || !apiKey) {
      toast.error(this.props.t("Please fill in all required fields"));
      return;
    }
    // 纯自助 OpenAI 兼容供应商：endpoint/apiKey/model 全部来自用户自填
    const config: AIModelConfig = {
      endpoint,
      modelName: modelId,
      modelId,
      apiKey,
      providerId: "custom",
      providerName: "OpenAI Compatible",
    };
    const key = isEditing ? editingKey : Date.now().toString();
    const modelEntry = {
      key,
      displayName: modelId,
      config,
    };

    try {
      ConfigService.setObjectConfig(key, modelEntry, "aiModelConfig");
      toast.success(
        this.props.t(isEditing ? "Update successful" : "Addition successful")
      );
      this.props.handleFetchPlugins();
      this.resetForm();
    } catch (e: any) {
      toast.error(this.props.t("Operation failed") + ": " + e.message);
    }
  };

  handleDelete = (key: string) => {
    try {
      ConfigService.deleteObjectConfig(key, "aiModelConfig");
      // 如果被删除的模型正被某个功能使用，则清空对应配置
      if (this.state.aiTranslateModel === key) {
        this.setState({ aiTranslateModel: "" });
        ConfigService.setReaderConfig("aiTranslateModel", "");
      }
      if (this.state.aiDictModel === key) {
        this.setState({ aiDictModel: "" });
        ConfigService.setReaderConfig("aiDictModel", "");
      }
      if (this.state.aiAssistanceModel === key) {
        this.setState({ aiAssistanceModel: "" });
        ConfigService.setReaderConfig("aiAssistanceModel", "");
      }
      toast.success(this.props.t("Deletion successful"));
    } catch (e: any) {
      toast.error(this.props.t("Deletion failed") + ": " + e.message);
    }
    this.props.handleFetchPlugins();
  };

  handleEdit = (plugin: any) => {
    const entry = ConfigService.getObjectConfig(
      plugin.key,
      "aiModelConfig",
      null
    );
    const config: AIModelConfig | null = entry
      ? entry.config
      : this.parseConfig(plugin);
    if (!config) {
      toast.error(this.props.t("Failed to parse model configuration"));
      return;
    }
    this.setState({
      isAddNew: true,
      isEditing: true,
      editingKey: plugin.key,
      selectedProvider: "custom",
      selectedModel: config.modelId || "",
      endpoint: config.endpoint || "",
      modelName: config.modelName || config.modelId || "",
      modelId: config.modelId || "",
      apiKey: config.apiKey || "",
      testResult: "",
      fetchedModels: [],
    });
    const infoEl = document.querySelector(".setting-dialog-info");
    if (infoEl) infoEl.scrollTop = 0;
  };

  handleEditPrompt = async (
    type: "aiTranslate" | "aiDict" | "aiAssistance"
  ) => {
    const configKey = type + "Prompt";
    const currentValue =
      (this.state as any)[configKey] || KookitConfig.DefaultPrompts[type];
    const result = await vexTextareaAsync(
      this.props.t("Edit prompt"),
      currentValue
    );
    if (result === false) return;
    (this.setState as any)({ [configKey]: result });
    ConfigService.setReaderConfig(configKey, result);
    toast.success(this.props.t("Change successful"));
  };

  renderAddForm = () => {
    const hasFetchedModels = this.state.fetchedModels.length > 0;

    return (
      <div
        className="voice-add-new-container"
        style={{
          marginLeft: "25px",
          width: "calc(100% - 50px)",
          fontWeight: 500,
        }}
      >
        {/* Base URL (Endpoint) */}
        <div className="ai-setting-form-row">
          <label className="ai-setting-label">
            <Trans>Endpoint</Trans>
          </label>
          <input
            type="text"
            className="token-dialog-username-box"
            placeholder="https://api.example.com/v1"
            value={this.state.endpoint}
            id="ai-endpoint-box"
            onContextMenu={() => {
              handleContextMenu("ai-endpoint-box", true);
            }}
            onChange={(e) =>
              this.setState({ endpoint: e.target.value.trim() })
            }
          />
        </div>

        {/* API Key */}
        <div className="ai-setting-form-row">
          <label className="ai-setting-label">API Key</label>
          <input
            type="password"
            className="token-dialog-username-box"
            placeholder={this.props.t("Enter your API Key")}
            value={this.state.apiKey}
            id="ai-api-key-box"
            onContextMenu={() => {
              handleContextMenu("ai-api-key-box", true);
            }}
            onChange={(e) =>
              this.setState({ apiKey: e.target.value.trim() })
            }
          />
        </div>

        {/* Model ID (free text) + Fetch models button */}
        <div className="ai-setting-form-row">
          <label className="ai-setting-label">
            <Trans>Model ID</Trans>
          </label>
          <input
            type="text"
            className="token-dialog-username-box"
            placeholder={this.props.t(
              "e.g. gpt-4o, claude-sonnet-4-20250514"
            )}
            value={this.state.modelId}
            id="ai-model-id-box"
            onContextMenu={() => {
              handleContextMenu("ai-model-id-box", true);
            }}
            onChange={(e) => {
              const modelId = e.target.value.trim();
              this.setState({ modelId, modelName: modelId });
            }}
          />
          <span
            className="change-location-button"
            style={{
              display: "inline-flex",
              marginLeft: "10px",
              marginTop: "6px",
              whiteSpace: "nowrap",
            }}
            onClick={this.handleFetchModels}
          >
            {this.state.isFetchingModels ? (
              <Trans>Loading...</Trans>
            ) : (
              <Trans>Fetch models</Trans>
            )}
          </span>
        </div>

        {/* Model selection dropdown (after models fetched) */}
        {hasFetchedModels && (
          <div className="ai-setting-form-row">
            <label className="ai-setting-label">
              <Trans>Select model</Trans>
            </label>
            <select
              className="lang-setting-dropdown"
              style={{ width: "160px" }}
              value={this.state.selectedModel}
              onChange={(e) => this.handleModelSelect(e.target.value)}
            >
              <option value="" className="lang-setting-option">
                {this.props.t("Please select a model")}
              </option>
              {this.state.fetchedModels.map((m) => (
                <option key={m.id} value={m.id} className="lang-setting-option">
                  {m.name || m.id}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Buttons: Add/Save, Cancel, Test */}
        <div className="token-dialog-button-container">
          <div className="voice-add-confirm" onClick={this.handleSave}>
            <Trans>{this.state.isEditing ? "Save" : "Add"}</Trans>
          </div>
          <div className="voice-add-button-container">
            <div className="voice-add-cancel" onClick={this.resetForm}>
              <Trans>Cancel</Trans>
            </div>
            <div
              className="voice-add-confirm"
              style={{ marginRight: "10px" }}
              onClick={this.handleTest}
            >
              {this.state.isTesting ? (
                <Trans>Testing...</Trans>
              ) : (
                <Trans>Test</Trans>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  render() {
    const aiModels = this.getAIModels();

    return (
      <>
        {this.state.isAddNew && this.renderAddForm()}

        <div
          style={{
            fontWeight: "bold",
            textAlign: "left",
            marginBottom: "20px",
            marginLeft: "20px",
            marginTop: "20px",
          }}
        >
          <Trans>Added AI models</Trans>
        </div>

        {aiModels.length === 0 && (
          <div
            style={{
              textAlign: "center",
              opacity: 0.5,
              padding: "30px 0",
              fontSize: "14px",
            }}
          >
            <Trans>No AI models added yet</Trans>
          </div>
        )}

        {aiModels.map((item) => {
          const config = this.parseConfig(item);
          return (
            <div
              className="setting-dialog-new-title"
              key={item.key}
              style={{ marginLeft: "15px" }}
            >
              <span>
                <span className="icon-ai-assist setting-plugin-icon"></span>
                <span className="setting-plugin-name">
                  {this.props.t(item.displayName)}
                </span>
                {config && (
                  <span
                    style={{
                      // fontSize: "12px",
                      opacity: 0.6,
                      marginLeft: "8px",
                    }}
                  >
                    ({config.providerName || config.providerId})
                  </span>
                )}
              </span>

              <span
                style={{
                  display: "flex",
                  gap: "10px",
                  alignItems: "center",
                }}
              >
                <span
                  className="change-location-button"
                  onClick={() => this.handleEdit(item)}
                >
                  <Trans>Edit</Trans>
                </span>
                <span
                  className="change-location-button"
                  onClick={() => this.handleDelete(item.key)}
                >
                  <Trans>Delete</Trans>
                </span>
              </span>
            </div>
          );
        })}

        <div
          style={{
            fontWeight: "bold",
            textAlign: "left",
            marginBottom: "20px",
            marginLeft: "20px",
            marginTop: "20px",
          }}
        >
          <Trans>Model assignment</Trans>
        </div>

        <div className="setting-dialog-new-title">
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Trans>AI translation model</Trans>
            <span
              className="change-location-button"
              style={{ fontSize: "12px" }}
              onClick={() => this.handleEditPrompt("aiTranslate")}
            >
              <Trans>Edit prompt</Trans>
            </span>
          </span>
          <select
            className="lang-setting-dropdown"
            value={this.state.aiTranslateModel}
            onChange={(e) => {
              const val = e.target.value;
              this.setState({ aiTranslateModel: val });
              ConfigService.setReaderConfig("aiTranslateModel", val);
              toast.success(this.props.t("Change successful"));
              this.props.handleFetchPlugins();
            }}
          >
            <option value="" className="lang-setting-option">
              {this.props.t("Please select")}
            </option>
            {aiModels.map((item) => (
              <option
                key={item.key}
                value={item.key}
                className="lang-setting-option"
              >
                {item.displayName}
              </option>
            ))}
          </select>
        </div>

        <div className="setting-dialog-new-title">
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Trans>AI dictionary model</Trans>
            <span
              className="change-location-button"
              style={{ fontSize: "12px" }}
              onClick={() => this.handleEditPrompt("aiDict")}
            >
              <Trans>Edit prompt</Trans>
            </span>
          </span>
          <select
            className="lang-setting-dropdown"
            value={this.state.aiDictModel}
            onChange={(e) => {
              const val = e.target.value;
              this.setState({ aiDictModel: val });
              ConfigService.setReaderConfig("aiDictModel", val);
              toast.success(this.props.t("Change successful"));
              this.props.handleFetchPlugins();
            }}
          >
            <option value="" className="lang-setting-option">
              {this.props.t("Please select")}
            </option>
            {aiModels.map((item) => (
              <option
                key={item.key}
                value={item.key}
                className="lang-setting-option"
              >
                {item.displayName}
              </option>
            ))}
          </select>
        </div>

        <div className="setting-dialog-new-title">
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Trans>AI assistance model</Trans>
            <span
              className="change-location-button"
              style={{ fontSize: "12px" }}
              onClick={() => this.handleEditPrompt("aiAssistance")}
            >
              <Trans>Edit prompt</Trans>
            </span>
          </span>
          <select
            className="lang-setting-dropdown"
            value={this.state.aiAssistanceModel}
            onChange={(e) => {
              const val = e.target.value;
              this.setState({ aiAssistanceModel: val });
              ConfigService.setReaderConfig("aiAssistanceModel", val);
              toast.success(this.props.t("Change successful"));
              this.props.handleFetchPlugins();
            }}
          >
            <option value="" className="lang-setting-option">
              {this.props.t("Please select")}
            </option>
            {aiModels.map((item) => (
              <option
                key={item.key}
                value={item.key}
                className="lang-setting-option"
              >
                {item.displayName}
              </option>
            ))}
          </select>
        </div>

        <div className="setting-dialog-new-plugin">
          <span
            style={{ fontWeight: "bold" }}
            onClick={() => {
              const infoEl = document.querySelector(".setting-dialog-info");
              this.setState(
                {
                  isAddNew: true,
                  isEditing: false,
                  editingKey: "",
                  selectedProvider: "",
                  selectedModel: "",
                  endpoint: "",
                  modelName: "",
                  modelId: "",
                  apiKey: "",
                  testResult: "",
                  fetchedModels: [],
                },
                () => {
                  if (infoEl) infoEl.scrollTop = 0;
                }
              );
            }}
          >
            <Trans>Add new model</Trans>
          </span>
        </div>
      </>
    );
  }
}

export default AISetting;
