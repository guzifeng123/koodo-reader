import React from "react";
import "./manager.css";
import { RedirectProps, RedirectState } from "./interface";
import { withRouter } from "react-router-dom";

class Redirect extends React.Component<RedirectProps, RedirectState> {
  componentDidMount() {
    this.props.history.replace("/manager/home");
  }
  render() {
    return <div className="manager"></div>;
  }
}

export default withRouter(Redirect as any);
